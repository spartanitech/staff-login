package com.spartan.attendance.service;

import com.spartan.attendance.dto.CallLogRequest;
import com.spartan.attendance.dto.CallLogResponse;
import com.spartan.attendance.entity.CallLog;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.CallLogRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Telephone Call Report on the server. A Sales Officer logs their own calls; managers read their team's. */
@Service
@RequiredArgsConstructor
public class CallLogService {

    private static final int MAX_RANGE_DAYS = 92;

    private final CallLogRepository repository;
    private final UserRepository userRepository;
    private final ScopeService scopeService;

    @Transactional
    public CallLogResponse log(AppUserDetails caller, CallLogRequest req) {
        if (caller.getRole() != Role.SO) {
            throw ApiException.forbidden("NOT_A_SALES_OFFICER", "Only a Sales Officer logs shop calls.");
        }
        String ref = req.ref() == null || req.ref().isBlank() ? null : req.ref().trim();
        if (ref != null) {
            var existing = repository.findByClientRef(ref);
            if (existing.isPresent()) {
                return CallLogResponse.from(existing.get());       // a re-send of a call already stored
            }
        }
        LocalDateTime now = TimeUtil.nowIst();
        LocalDateTime at = req.at() == null ? now : LocalDateTime.ofInstant(req.at(), TimeUtil.IST);
        if (at.isAfter(now.plusMinutes(5)) || at.isBefore(now.minusDays(30))) {
            at = now;                                              // a phone with a wrong clock: trust the server
        }
        User officer = userRepository.findById(caller.getId()).orElseThrow(() -> ApiException.notFound("User not found."));
        CallLog c = CallLog.builder()
                .officer(officer).shopName(req.shop().trim())
                .mobile(req.mobile() == null || req.mobile().isBlank() ? null : req.mobile().trim())
                .callDate(at.toLocalDate()).calledAt(at).clientRef(ref)
                .build();
        return CallLogResponse.from(repository.save(c));
    }

    /** officerId null = everyone I may see (just me for a Sales Officer). Default range: last 30 days. */
    @Transactional(readOnly = true)
    public List<CallLogResponse> list(AppUserDetails caller, Long officerId, LocalDate from, LocalDate to) {
        LocalDate end = to == null ? TimeUtil.nowIst().toLocalDate() : to;
        LocalDate start = from == null ? end.minusDays(30) : from;
        if (start.isAfter(end) || start.plusDays(MAX_RANGE_DAYS).isBefore(end)) {
            throw ApiException.badRequest("BAD_RANGE", "Choose a range of at most " + MAX_RANGE_DAYS + " days.");
        }
        List<CallLog> rows;
        if (officerId != null) {
            scopeService.assertVisible(caller, officerId);
            rows = repository.findForOfficers(Set.of(officerId), start, end);
        } else {
            ScopeService.Scope scope = scopeService.scopeOf(caller);
            rows = scope.all() ? repository.findAllBetween(start, end) : repository.findForOfficers(scope.ids(), start, end);
        }
        return rows.stream().map(CallLogResponse::from).toList();
    }

    /** Correct the shop name of a call (own, or Admin). */
    @Transactional
    public CallLogResponse rename(AppUserDetails caller, Long id, String shop) {
        CallLog c = owned(caller, id);
        if (shop == null || shop.isBlank()) {
            throw ApiException.badRequest("SHOP_REQUIRED", "Shop name is required.");
        }
        c.setShopName(shop.trim().length() > 150 ? shop.trim().substring(0, 150) : shop.trim());
        return CallLogResponse.from(repository.save(c));
    }

    @Transactional
    public void delete(AppUserDetails caller, Long id) {
        repository.delete(owned(caller, id));
    }

    private CallLog owned(AppUserDetails caller, Long id) {
        CallLog c = repository.findById(id).orElseThrow(() -> ApiException.notFound("Call not found."));
        if (caller.getRole() != Role.ADMIN && !c.getOfficer().getId().equals(caller.getId())) {
            throw ApiException.forbidden("NOT_YOUR_CALL", "You can only change your own calls.");
        }
        return c;
    }
}
