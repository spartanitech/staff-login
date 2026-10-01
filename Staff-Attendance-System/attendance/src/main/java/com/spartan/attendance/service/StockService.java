package com.spartan.attendance.service;

import com.spartan.attendance.dto.StockDayRequest;
import com.spartan.attendance.dto.StockEntryResponse;
import com.spartan.attendance.entity.StockEntry;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.StockEntryRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Weekly Stock Report - daily stock per product for a Sales Officer. The server does all the arithmetic:
 *   Total Stock         = Opening Stock + Receipt
 *   Total Sales         = SO Sales + DP Sales
 *   Final Closing Stock = Total Stock - Total Sales
 *   next day's Opening  = this day's Final Closing Stock (saved to the repository straight away)
 * Opening is only typed in for a product's very first day on record. Changing an earlier day re-flows the
 * openings/closings of every later day of that product.
 */
@Service
@RequiredArgsConstructor
public class StockService {

    private static final int MAX_RANGE_DAYS = 400;

    private final StockEntryRepository repository;
    private final UserRepository userRepository;
    private final ScopeService scopeService;

    /** Entries between from and to (inclusive). officerId null = the caller; managers may read their own team's. */
    @Transactional(readOnly = true)
    public List<StockEntryResponse> list(AppUserDetails caller, Long officerId, LocalDate from, LocalDate to) {
        Long who = officerId == null ? caller.getId() : officerId;
        scopeService.assertVisible(caller, who);
        LocalDate end = to == null ? today() : to;
        LocalDate start = from == null ? end.minusDays(6) : from;
        if (start.isAfter(end)) {
            throw ApiException.badRequest("BAD_RANGE", "'from' must be on or before 'to'.");
        }
        if (start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("RANGE_TOO_LONG", "Please ask for at most " + MAX_RANGE_DAYS + " days at a time.");
        }
        return repository.findByOfficerIdAndEntryDateBetweenOrderByEntryDateAscIdAsc(who, start, end)
                .stream().map(StockEntryResponse::from).toList();
    }

    /**
     * Every stock entry between from and to (inclusive) of everyone the caller may see: the whole company for
     * ADMIN/OWNER, the reporting tree for a manager, only themselves for a Sales Officer. This is the "actual sales"
     * feed the Sales Analysis and the manager dashboards are built from (SO Sales + DP Sales x unit price).
     */
    @Transactional(readOnly = true)
    public List<StockEntryResponse> team(AppUserDetails caller, LocalDate from, LocalDate to) {
        LocalDate end = to == null ? today() : to;
        LocalDate start = from == null ? end.withDayOfMonth(1) : from;
        if (start.isAfter(end)) {
            throw ApiException.badRequest("BAD_RANGE", "'from' must be on or before 'to'.");
        }
        if (start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("RANGE_TOO_LONG", "Please ask for at most " + MAX_RANGE_DAYS + " days at a time.");
        }
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        return repository.findAllBetween(start, end).stream()
                .filter(e -> scope.contains(e.getOfficer().getId()))
                .map(StockEntryResponse::from)
                .toList();
    }

    /** product -> opening stock for the given day (= the closing of the latest earlier day on record). */
    @Transactional(readOnly = true)
    public Map<String, Integer> openings(AppUserDetails caller, Long officerId, LocalDate date) {
        Long who = officerId == null ? caller.getId() : officerId;
        scopeService.assertVisible(caller, who);
        Map<String, Integer> out = new LinkedHashMap<>();
        for (StockEntry e : repository.findLatestBefore(who, date == null ? today() : date)) {
            out.put(e.getProduct(), e.getClosing());
        }
        return out;
    }

    /** Saves the caller's own stock for one day and returns everything on record for that day. */
    @Transactional
    public List<StockEntryResponse> saveDay(AppUserDetails caller, LocalDate date, StockDayRequest req) {
        if (date == null) {
            throw ApiException.badRequest("DATE_REQUIRED", "Choose the date of the stock report.");
        }
        if (date.isAfter(today())) {
            throw ApiException.badRequest("FUTURE_DATE", "Stock cannot be entered for a future date.");
        }
        User officer = userRepository.findById(caller.getId())
                .orElseThrow(() -> ApiException.notFound("User not found."));
        Map<String, StockEntry> previous = new HashMap<>();
        for (StockEntry e : repository.findLatestBefore(officer.getId(), date)) {
            previous.put(e.getProduct(), e);
        }
        String dpName = clean(req.dpName());

        for (StockDayRequest.Row row : req.rows()) {
            String product = row.product().trim();
            StockEntry existing = repository.findByOfficerIdAndEntryDateAndProduct(officer.getId(), date, product).orElse(null);
            int receipt = nz(row.receipt());
            int soSales = nz(row.soSales());
            int dpSales = nz(row.dpSales());
            StockEntry prev = previous.get(product);
            int opening = prev != null ? prev.getClosing()
                    : (row.opening() != null ? row.opening() : (existing != null ? existing.getOpening() : 0));

            boolean empty = receipt == 0 && soSales == 0 && dpSales == 0 && (prev != null || opening == 0);
            if (existing == null && empty) {
                continue; // nothing typed for this product today - its opening still carries forward on its own
            }
            StockTotals t = calculate(opening, receipt, soSales, dpSales);
            if (t.closing() < 0) {
                throw ApiException.badRequest("STOCK_NEGATIVE", product + ": Total Sales (" + t.totalSales()
                        + ") is more than Total Stock (" + t.totalStock() + ").");
            }
            StockEntry e = existing != null ? existing
                    : StockEntry.builder().officer(officer).entryDate(date).product(product).build();
            e.setCategory(clean(row.category()) != null ? clean(row.category()) : e.getCategory());
            apply(e, t);
            if (row.unitPrice() != null) {
                e.setUnitPrice(row.unitPrice());
            }
            if (dpName != null) {
                e.setDpName(dpName);
            }
            repository.save(e);
            carryForward(officer, e);
        }
        return repository.findByOfficerIdAndEntryDateBetweenOrderByEntryDateAscIdAsc(officer.getId(), date, date)
                .stream().map(StockEntryResponse::from).toList();
    }

    // ------------------------------------------------------------------ calculation

    /** The numbers of one product on one day. */
    public record StockTotals(int opening, int receipt, int totalStock, int soSales, int dpSales, int totalSales, int closing) {
    }

    /**
     * Total Stock = Opening + Receipt, Total Sales = SO Sales + DP Sales, Final Closing Stock = Total Stock - Total Sales.
     * The caller decides what to do with a negative closing.
     */
    public static StockTotals calculate(int opening, int receipt, int soSales, int dpSales) {
        int totalStock = opening + receipt;
        int totalSales = soSales + dpSales;
        int closing = totalStock - totalSales;
        return new StockTotals(opening, receipt, totalStock, soSales, dpSales, totalSales, closing);
    }

    private static void apply(StockEntry e, StockTotals t) {
        e.setOpening(t.opening());
        e.setReceipt(t.receipt());
        e.setTotalStock(t.totalStock());
        e.setSoSales(t.soSales());
        e.setDpSales(t.dpSales());
        e.setTotalSales(t.totalSales());
        e.setClosing(t.closing());
    }

    /**
     * Makes this day's Final Closing Stock the Opening Stock of the next date and saves it:
     *  - the next date gets a row (Opening = this closing, nothing received or sold yet) if it has none, and
     *  - every later day already on record is recalculated from the day before's closing.
     */
    private void carryForward(User officer, StockEntry day) {
        Long officerId = officer.getId();
        String product = day.getProduct();
        LocalDate next = day.getEntryDate().plusDays(1);
        if (!repository.existsByOfficerIdAndEntryDateAndProduct(officerId, next, product)) {
            StockEntry n = StockEntry.builder()
                    .officer(officer)
                    .entryDate(next)
                    .product(product)
                    .category(day.getCategory())
                    .unitPrice(day.getUnitPrice())
                    .dpName(day.getDpName())
                    .build();
            apply(n, calculate(day.getClosing(), 0, 0, 0));
            repository.save(n);
        }

        int carry = day.getClosing();
        List<StockEntry> later = repository.findByOfficerIdAndProductAndEntryDateAfterOrderByEntryDateAsc(officerId, product, day.getEntryDate());
        for (StockEntry e : later) {
            StockTotals t = calculate(carry, e.getReceipt(), e.getSoSales(), e.getDpSales());
            if (t.closing() < 0) {
                throw ApiException.badRequest("STOCK_NEGATIVE_LATER", product + ": with this change the stock on "
                        + e.getEntryDate() + " would go below zero (Total Stock " + t.totalStock() + ", Total Sales "
                        + t.totalSales() + "). Please correct that day too.");
            }
            apply(e, t);
            carry = t.closing();
        }
        if (!later.isEmpty()) {
            repository.saveAll(later);
        }
    }

    private static LocalDate today() {
        return TimeUtil.nowIst().toLocalDate();
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    private static String clean(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }
}
