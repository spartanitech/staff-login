package com.spartan.attendance.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.SalesOrder;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.SalesOrderRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Orders booked by Sales Officers, kept on the server. Only a Sales Officer saves their own orders; who may read them
 * follows the reporting tree (ScopeService): the officer sees their own, an ASM / RM / Marketing Manager sees their team's,
 * the Admin and Owner see everyone's. Saving an order never touches attendance.
 */
@Service
@RequiredArgsConstructor
public class OrderService {

    private static final int MAX_RANGE_DAYS = 400;
    private static final int MAX_ITEMS = 500;
    private static final Set<String> STATUSES = Set.of("CONFIRMED", "CANCELLED");
    private static final TypeReference<List<Map<String, Object>>> ITEMS = new TypeReference<>() { };

    private final SalesOrderRepository repository;
    private final UserRepository userRepository;
    private final ScopeService scopeService;
    private final ObjectMapper objectMapper;

    /** One product line of an order, as the order form has it. */
    public record Item(String name, String category, Double price, Double qty) {
    }

    /** What the phone sends. clientRef makes a re-send (after a dropped connection) update the same order. */
    public record OrderRequest(String clientRef, Long shopId, String shopName, LocalDate date, List<Item> items, String status) {
    }

    public record OrderResponse(Long id, String clientRef, Long officerId, String officerName, String officerArea,
                                Long managerId, String managerName, Long shopId, String shopName, LocalDate date,
                                List<Map<String, Object>> items, int itemCount, double total, String status,
                                LocalDateTime createdAt, LocalDateTime updatedAt) {
    }

    @Transactional(readOnly = true)
    public List<OrderResponse> list(AppUserDetails caller, Long officerId, LocalDate from, LocalDate to) {
        LocalDate end = to == null ? today() : to;
        LocalDate start = from == null ? end.minusDays(30) : from;
        if (start.isAfter(end) || start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("BAD_RANGE", "Choose a range of at most " + MAX_RANGE_DAYS + " days.");
        }
        List<SalesOrder> rows;
        if (officerId != null) {
            scopeService.assertVisible(caller, officerId);
            rows = repository.findByOfficerIdInAndOrderDateBetweenOrderByOrderDateDescIdDesc(List.of(officerId), start, end);
        } else {
            ScopeService.Scope scope = scopeService.scopeOf(caller);
            rows = scope.all()
                    ? repository.findByOrderDateBetweenOrderByOrderDateDescIdDesc(start, end)
                    : repository.findByOfficerIdInAndOrderDateBetweenOrderByOrderDateDescIdDesc(scope.ids(), start, end);
        }
        return rows.stream().map(this::toResponse).toList();
    }

    /** A Sales Officer saves (or re-saves) one of their own orders. */
    @Transactional
    public OrderResponse save(AppUserDetails caller, OrderRequest req) {
        if (caller.getRole() != Role.SO) {
            throw ApiException.forbidden("NOT_A_SALES_OFFICER", "Only a Sales Officer books orders.");
        }
        if (req == null) {
            throw ApiException.badRequest("BAD_ORDER", "The order could not be read.");
        }
        String ref = trim(req.clientRef());
        if (ref == null || ref.length() > 100) {
            throw ApiException.badRequest("BAD_ORDER", "The order reference is missing.");
        }
        String shop = trim(req.shopName());
        if (shop == null) {
            throw ApiException.badRequest("SHOP_REQUIRED", "Choose the shop of this order.");
        }
        if (shop.length() > 150) {
            shop = shop.substring(0, 150);
        }
        LocalDate date = req.date() == null ? today() : req.date();
        if (date.isAfter(today())) {
            throw ApiException.badRequest("FUTURE_DATE", "An order cannot be saved for a future date.");
        }
        List<Item> items = req.items() == null ? List.of() : req.items();
        if (items.isEmpty()) {
            throw ApiException.badRequest("NO_ITEMS", "Add at least one product to the order.");
        }
        if (items.size() > MAX_ITEMS) {
            throw ApiException.badRequest("TOO_MANY_ITEMS", "An order can have at most " + MAX_ITEMS + " products.");
        }
        List<Map<String, Object>> clean = new ArrayList<>();
        double total = 0;
        for (Item it : items) {
            if (it == null || trim(it.name()) == null) {
                continue;
            }
            double qty = it.qty() == null ? 0 : it.qty();
            double price = it.price() == null ? 0 : it.price();
            if (qty <= 0 || price < 0 || Double.isNaN(qty) || Double.isNaN(price) || Double.isInfinite(qty) || Double.isInfinite(price)) {
                continue;
            }
            Map<String, Object> line = new LinkedHashMap<>();
            line.put("name", cut(trim(it.name()), 200));
            line.put("category", cut(trim(it.category()), 80));
            line.put("price", price);
            line.put("qty", qty);
            clean.add(line);
            total += qty * price;
        }
        if (clean.isEmpty()) {
            throw ApiException.badRequest("NO_ITEMS", "Add at least one product with a quantity to the order.");
        }
        String status = req.status() == null ? "CONFIRMED" : req.status().trim().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(status)) {
            status = "CONFIRMED";
        }

        User officer = userRepository.findById(caller.getId()).orElseThrow(() -> ApiException.notFound("User not found."));
        SalesOrder o = repository.findByOfficerIdAndClientRef(officer.getId(), ref)
                .orElseGet(() -> SalesOrder.builder().officer(officer).clientRef(ref).build());
        o.setOrderDate(date);
        o.setShopId(req.shopId());
        o.setShopName(shop);
        o.setItemsJson(write(clean));
        o.setItemCount(clean.size());
        o.setTotalAmount(Math.round(total * 100.0) / 100.0);
        o.setStatus(status);
        return toResponse(repository.save(o));
    }

    private OrderResponse toResponse(SalesOrder o) {
        User u = o.getOfficer();
        User m = u.getReportingManager();
        return new OrderResponse(o.getId(), o.getClientRef(), u.getId(), u.getName(), u.getArea(),
                m == null ? null : m.getId(), m == null ? null : m.getName(), o.getShopId(), o.getShopName(), o.getOrderDate(),
                read(o.getItemsJson()), o.getItemCount(), o.getTotalAmount(), o.getStatus(), o.getCreatedAt(), o.getUpdatedAt());
    }

    private String write(List<Map<String, Object>> items) {
        try {
            return objectMapper.writeValueAsString(items);
        } catch (JsonProcessingException e) {
            throw ApiException.badRequest("BAD_ORDER", "The order could not be read.");
        }
    }

    private List<Map<String, Object>> read(String json) {
        if (json == null || json.isBlank()) {
            return new ArrayList<>();
        }
        try {
            return objectMapper.readValue(json, ITEMS);
        } catch (JsonProcessingException e) {
            return new ArrayList<>();
        }
    }

    private static String trim(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    private static LocalDate today() {
        return TimeUtil.nowIst().toLocalDate();
    }
}
