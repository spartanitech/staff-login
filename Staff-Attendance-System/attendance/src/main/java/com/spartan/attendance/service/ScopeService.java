package com.spartan.attendance.service;

import com.spartan.attendance.entity.Role;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who may see whose data. This is THE place the "own team only" rule lives, and every listing/report
 * goes through it - the frontend's filtering is cosmetic.
 *   ADMIN, OWNER  -> everyone
 *   RSM, RM, ASM  -> themselves + everyone below them in the reportingManager tree (any depth)
 *   SO            -> only themselves
 */
@Service
@RequiredArgsConstructor
public class ScopeService {

    private final UserRepository userRepository;

    /** all == true means no restriction; otherwise ids is the exact set of visible user ids. */
    public record Scope(boolean all, Set<Long> ids) {
        public boolean contains(Long userId) {
            return all || ids.contains(userId);
        }
    }

    @Transactional(readOnly = true)
    public Scope scopeOf(AppUserDetails caller) {
        Role role = caller.getRole();
        if (role.hasGlobalScope()) {
            return new Scope(true, Set.of());
        }
        Set<Long> ids = new HashSet<>();
        ids.add(caller.getId());
        if (role.isManager()) {
            ids.addAll(descendantsOf(caller.getId()));
        }
        return new Scope(false, ids);
    }

    public void assertVisible(AppUserDetails caller, Long targetUserId) {
        if (!scopeOf(caller).contains(targetUserId)) {
            throw ApiException.forbidden("OUT_OF_SCOPE", "You can only view people who report to you.");
        }
    }

    private Set<Long> descendantsOf(Long managerId) {
        Map<Long, List<Long>> children = new HashMap<>();
        for (Object[] link : userRepository.findManagerLinks()) {
            Long child = (Long) link[0];
            Long manager = (Long) link[1];
            children.computeIfAbsent(manager, k -> new java.util.ArrayList<>()).add(child);
        }
        Set<Long> seen = new HashSet<>();
        Deque<Long> queue = new ArrayDeque<>();
        queue.add(managerId);
        while (!queue.isEmpty()) {          // seen-set guards against an accidental reporting cycle
            Long current = queue.poll();
            for (Long child : children.getOrDefault(current, List.of())) {
                if (seen.add(child)) {
                    queue.add(child);
                }
            }
        }
        seen.remove(managerId);
        return seen;
    }
}
