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
 * Daily stock per product for a Sales Officer:
 *   closing = opening + receipt - SO sales - DP sales
 *   next day's opening = previous closing (never typed in, except for a product's very first day on record)
 * Changing an earlier day re-flows the openings/closings of every later day of that product.
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
            int closing = opening + receipt - soSales - dpSales;
            if (closing < 0) {
                throw ApiException.badRequest("STOCK_NEGATIVE", product + ": SO Sales + DP Sales (" + (soSales + dpSales)
                        + ") is more than Opening + Receipt (" + (opening + receipt) + ").");
            }
            StockEntry e = existing != null ? existing
                    : StockEntry.builder().officer(officer).entryDate(date).product(product).build();
            e.setCategory(clean(row.category()) != null ? clean(row.category()) : e.getCategory());
            e.setOpening(opening);
            e.setReceipt(receipt);
            e.setSoSales(soSales);
            e.setDpSales(dpSales);
            e.setClosing(closing);
            if (row.unitPrice() != null) {
                e.setUnitPrice(row.unitPrice());
            }
            if (dpName != null) {
                e.setDpName(dpName);
            }
            repository.save(e);
            reflowAfter(officer.getId(), product, date, closing);
        }
        return repository.findByOfficerIdAndEntryDateBetweenOrderByEntryDateAscIdAsc(officer.getId(), date, date)
                .stream().map(StockEntryResponse::from).toList();
    }

    /** Every later day of this product starts from the day before's closing. */
    private void reflowAfter(Long officerId, String product, LocalDate date, int closing) {
        int carry = closing;
        List<StockEntry> later = repository.findByOfficerIdAndProductAndEntryDateAfterOrderByEntryDateAsc(officerId, product, date);
        for (StockEntry e : later) {
            e.setOpening(carry);
            e.setClosing(carry + e.getReceipt() - e.getSoSales() - e.getDpSales());
            carry = e.getClosing();
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
