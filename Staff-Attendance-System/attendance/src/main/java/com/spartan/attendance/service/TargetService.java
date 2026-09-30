package com.spartan.attendance.service;

import com.spartan.attendance.dto.TargetRequest;
import com.spartan.attendance.dto.TargetResponse;
import com.spartan.attendance.entity.SalesTarget;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.SalesTargetRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Monthly sales targets. A manager (normally the ASM) sets them for people in their own team; everyone can read their own. */
@Service
@RequiredArgsConstructor
public class TargetService {

    private final SalesTargetRepository repository;
    private final UserRepository userRepository;
    private final ScopeService scopeService;

    @Transactional(readOnly = true)
    public TargetResponse get(AppUserDetails caller, Long officerId, String month) {
        Long who = officerId == null ? caller.getId() : officerId;
        scopeService.assertVisible(caller, who);
        String m = month(month);
        return repository.findByOfficerIdAndMonth(who, m).map(TargetResponse::from).orElseGet(() -> {
            User u = userRepository.findById(who).orElseThrow(() -> ApiException.notFound("User not found."));
            return new TargetResponse(u.getId(), u.getName(), m, 0L, null);
        });
    }

    @Transactional(readOnly = true)
    public List<TargetResponse> team(AppUserDetails caller, String month) {
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        return repository.findByMonth(month(month)).stream()
                .filter(t -> scope.contains(t.getOfficer().getId()))
                .map(TargetResponse::from)
                .toList();
    }

    @Transactional
    public TargetResponse set(AppUserDetails caller, TargetRequest req) {
        boolean global = caller.getRole().hasGlobalScope();
        if (!global && !caller.getRole().isManager()) {
            throw ApiException.forbidden("NOT_A_MANAGER", "Only your manager can set your target.");
        }
        if (!global && caller.getId().equals(req.officerId())) {
            throw ApiException.forbidden("OWN_TARGET", "Your own target is set by your manager.");
        }
        scopeService.assertVisible(caller, req.officerId());
        User officer = userRepository.findById(req.officerId()).orElseThrow(() -> ApiException.notFound("User not found."));
        User setter = userRepository.findById(caller.getId()).orElse(null);
        SalesTarget t = repository.findByOfficerIdAndMonth(officer.getId(), req.month())
                .orElseGet(() -> SalesTarget.builder().officer(officer).month(req.month()).build());
        t.setAmount(req.amount());
        t.setSetBy(setter);
        return TargetResponse.from(repository.save(t));
    }

    private static String month(String m) {
        if (m == null || m.isBlank()) {
            return TimeUtil.nowIst().format(DateTimeFormatter.ofPattern("yyyy-MM"));
        }
        if (!m.matches("^\\d{4}-(0[1-9]|1[0-2])$")) {
            throw ApiException.badRequest("BAD_MONTH", "month must look like 2026-09");
        }
        return m;
    }
}
