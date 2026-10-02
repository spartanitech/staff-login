package com.spartan.attendance.service;

import com.spartan.attendance.entity.Promotion;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.PromotionRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Promotions on the server: everyone signed in may read them; Admin, Owner and Marketing Manager change them. */
@Service
@RequiredArgsConstructor
public class PromotionService {

    private static final Set<String> KINDS = Set.of("offer", "coupon", "festival", "combo", "report");
    private static final String INIT = "_init";

    private final PromotionRepository repository;

    @Transactional(readOnly = true)
    public Map<String, Object> list() {
        List<Map<String, Object>> items = new ArrayList<>();
        boolean initialized = false;
        for (Promotion p : repository.findAllByOrderByIdAsc()) {
            if (INIT.equals(p.getKind())) { initialized = true; continue; }
            items.add(toMap(p));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("initialized", initialized || !items.isEmpty());
        out.put("items", items);
        return out;
    }

    @Transactional
    public Map<String, Object> create(AppUserDetails caller, Map<String, Object> body) {
        requireEditor(caller);
        Promotion p = build(caller, body);
        if (p.getClientRef() != null) {
            var existing = repository.findByClientRef(p.getClientRef());
            if (existing.isPresent()) return toMap(existing.get());
        }
        return toMap(repository.save(p));
    }

    /** First run only: stores the screen's starting list once. Does nothing when the server already has promotions. */
    @Transactional
    public Map<String, Object> importInitial(AppUserDetails caller, List<Map<String, Object>> items) {
        requireEditor(caller);
        if (repository.count() == 0) {
            if (items != null) {
                for (Map<String, Object> m : items) {
                    try { repository.save(build(caller, m)); } catch (ApiException ignored) { /* skip a bad row */ }
                }
            }
            repository.save(Promotion.builder().kind(INIT).createdBy(caller.getId()).createdAt(TimeUtil.nowIst()).build());
        }
        return list();
    }

    @Transactional
    public void delete(AppUserDetails caller, Long id) {
        requireEditor(caller);
        Promotion p = repository.findById(id).orElseThrow(() -> ApiException.notFound("Promotion not found."));
        if (INIT.equals(p.getKind())) throw ApiException.notFound("Promotion not found.");
        repository.delete(p);
        if (!repository.existsByKind(INIT)) {   // keep the marker so an empty list stays empty
            repository.save(Promotion.builder().kind(INIT).createdBy(caller.getId()).createdAt(TimeUtil.nowIst()).build());
        }
    }

    private static void requireEditor(AppUserDetails caller) {
        Role r = caller.getRole();
        if (r != Role.ADMIN && r != Role.OWNER && r != Role.RSM) {
            throw ApiException.forbidden("NOT_ALLOWED", "Only Admin, Owner or Marketing Manager can change promotions.");
        }
    }

    private static Promotion build(AppUserDetails caller, Map<String, Object> m) {
        String kind = str(m.get("kind"), 20);
        if (kind == null || !KINDS.contains(kind)) {
            throw ApiException.badRequest("BAD_KIND", "Unknown promotion type.");
        }
        String name = str(m.get("name"), 150);
        String code = str(m.get("code"), 60);
        if (name == null && code == null) {
            throw ApiException.badRequest("NAME_REQUIRED", "Please enter a name.");
        }
        return Promotion.builder()
                .kind(kind).name(name).code(code)
                .type(str(m.get("type"), 40))
                .discount(str(m.get("discount"), 60))
                .validTill(str(m.get("validTill"), 40))
                .price(num(m.get("price")))
                .mrp(num(m.get("mrp")))
                .redemptions(num(m.get("redemptions")) == null ? null : num(m.get("redemptions")).intValue())
                .totalDiscount(num(m.get("totalDiscount")))
                .clientRef(str(m.get("ref"), 64))
                .createdBy(caller.getId())
                .createdAt(TimeUtil.nowIst())
                .build();
    }

    private static String str(Object o, int max) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        if (s.isEmpty()) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static Double num(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.doubleValue();
        try { return Double.valueOf(String.valueOf(o).trim()); } catch (NumberFormatException e) { return null; }
    }

    private static Map<String, Object> toMap(Promotion p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.getId());
        m.put("kind", p.getKind());
        m.put("name", p.getName());
        m.put("code", p.getCode());
        m.put("type", p.getType());
        m.put("discount", p.getDiscount());
        m.put("validTill", p.getValidTill());
        m.put("price", p.getPrice());
        m.put("mrp", p.getMrp());
        m.put("redemptions", p.getRedemptions());
        m.put("totalDiscount", p.getTotalDiscount());
        m.put("ref", p.getClientRef());
        return m;
    }
}
