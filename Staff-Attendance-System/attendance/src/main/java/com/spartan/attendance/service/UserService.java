package com.spartan.attendance.service;

import com.spartan.attendance.dto.PasswordResetRequest;
import com.spartan.attendance.dto.StatusRequest;
import com.spartan.attendance.dto.UserCreateRequest;
import com.spartan.attendance.dto.UserResponse;
import com.spartan.attendance.dto.UserUpdateRequest;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.AttendanceRepository;
import com.spartan.attendance.repository.CallLogRepository;
import com.spartan.attendance.repository.PortalMessageRepository;
import com.spartan.attendance.repository.SalesOrderRepository;
import com.spartan.attendance.repository.ShopRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.RequestInfo;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.dao.DataAccessException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final ShopRepository shopRepository;
    private final AttendanceRepository attendanceRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;
    private final ScopeService scopeService;
    private final PortalMessageRepository messageRepository;
    private final CallLogRepository callLogRepository;
    private final SalesOrderRepository salesOrderRepository;

    /** ADMIN/OWNER: everyone. Managers: their reporting tree. SO: only themselves. */
    @Transactional(readOnly = true)
    public List<UserResponse> list(AppUserDetails caller) {
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        return userRepository.findAllWithManager().stream()
                .filter(u -> scope.contains(u.getId()))
                .map(UserResponse::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public UserResponse get(AppUserDetails caller, Long id) {
        scopeService.assertVisible(caller, id);
        return UserResponse.from(find(id));
    }

    @Transactional
    public UserResponse create(AppUserDetails admin, UserCreateRequest req, RequestInfo info) {
        String username = req.username().trim();
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw ApiException.conflict("USERNAME_TAKEN", "That username is already in use.");
        }
        String code = req.employeeCode() == null || req.employeeCode().isBlank()
                ? nextEmployeeCode(req.role()) : req.employeeCode().trim();
        if (userRepository.existsByEmployeeCodeIgnoreCase(code)) {
            throw ApiException.conflict("EMPLOYEE_CODE_TAKEN", "That employee code is already in use.");
        }
        User user = User.builder()
                .employeeCode(code)
                .name(req.name().trim())
                .username(username)
                .passwordHash(passwordEncoder.encode(req.password()))
                .email(blankToNull(req.email()))
                .phone(blankToNull(req.phone()))
                .role(req.role())
                .designation(blankToNull(req.designation()))
                .area(blankToNull(req.area()))
                .region(blankToNull(req.region()))
                .status(Status.ACTIVE)
                .reportingManager(resolveManager(req.reportingManagerId(), null))
                .build();
        user = userRepository.save(user);
        auditService.log(admin.getId(), AuditAction.USER_CREATE,
                "Created user " + user.getUsername() + " (" + user.getEmployeeCode() + ") with role " + user.getRole(), info);
        return UserResponse.from(user);
    }

    @Transactional
    public UserResponse update(AppUserDetails admin, Long id, UserUpdateRequest req, RequestInfo info) {
        User user = find(id);
        String username = req.username().trim();
        if (!username.equalsIgnoreCase(user.getUsername()) && userRepository.existsByUsernameIgnoreCase(username)) {
            throw ApiException.conflict("USERNAME_TAKEN", "That username is already in use.");
        }
        if (user.getId().equals(admin.getId()) && req.role() != user.getRole()) {
            throw ApiException.badRequest("CANNOT_CHANGE_OWN_ROLE", "You cannot change your own role.");
        }
        if (user.getRole() == Role.ADMIN && req.role() != Role.ADMIN
                && user.getStatus() == Status.ACTIVE
                && userRepository.countByRoleAndStatus(Role.ADMIN, Status.ACTIVE) <= 1) {
            throw ApiException.badRequest("LAST_ADMIN", "At least one active Admin must remain.");
        }
        String before = describe(user);
        user.setName(req.name().trim());
        user.setUsername(username);
        user.setRole(req.role());
        user.setEmail(blankToNull(req.email()));
        user.setPhone(blankToNull(req.phone()));
        user.setDesignation(blankToNull(req.designation()));
        user.setArea(blankToNull(req.area()));
        user.setRegion(blankToNull(req.region()));
        user.setReportingManager(resolveManager(req.reportingManagerId(), user.getId()));
        user = userRepository.save(user);
        auditService.log(admin.getId(), AuditAction.USER_UPDATE,
                "Updated user " + user.getUsername() + ": [" + before + "] -> [" + describe(user) + "]", info);
        return UserResponse.from(user);
    }

    @Transactional
    public UserResponse setStatus(AppUserDetails admin, Long id, StatusRequest req, RequestInfo info) {
        User user = find(id);
        if (req.status() == Status.INACTIVE) {
            if (user.getId().equals(admin.getId())) {
                throw ApiException.badRequest("CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account.");
            }
            if (user.getRole() == Role.ADMIN && user.getStatus() == Status.ACTIVE
                    && userRepository.countByRoleAndStatus(Role.ADMIN, Status.ACTIVE) <= 1) {
                throw ApiException.badRequest("LAST_ADMIN", "At least one active Admin must remain.");
            }
        }
        Status old = user.getStatus();
        user.setStatus(req.status());
        user = userRepository.save(user);
        auditService.log(admin.getId(), AuditAction.USER_STATUS_CHANGE,
                "User " + user.getUsername() + " status " + old + " -> " + req.status(), info);
        return UserResponse.from(user);
    }

    @Transactional
    public void resetPassword(AppUserDetails admin, Long id, PasswordResetRequest req, RequestInfo info) {
        User user = find(id);
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        userRepository.save(user);
        auditService.log(admin.getId(), AuditAction.PASSWORD_RESET, "Reset password for user " + user.getUsername(), info);
    }

    /**
     * Permanently removes a staff account. Their own attendance history goes with them; any shop assigned to them is
     * left in place but becomes unassigned rather than being deleted. Refused if someone still reports to this person
     * (reassign those first) or if this is the last active Admin - deactivate instead if the history should be kept.
     */
    @Transactional
    public void delete(AppUserDetails admin, Long id, RequestInfo info) {
        User user = find(id);
        if (user.getId().equals(admin.getId())) {
            throw ApiException.badRequest("CANNOT_DELETE_SELF", "You cannot delete your own account.");
        }
        if (user.getRole() == Role.ADMIN && user.getStatus() == Status.ACTIVE
                && userRepository.countByRoleAndStatus(Role.ADMIN, Status.ACTIVE) <= 1) {
            throw ApiException.badRequest("LAST_ADMIN", "At least one active Admin must remain.");
        }
        List<User> reports = userRepository.findDirectReports(id);
        if (!reports.isEmpty()) {
            String names = reports.stream().map(User::getName).collect(java.util.stream.Collectors.joining(", "));
            throw ApiException.conflict("HAS_SUBORDINATES",
                    reports.size() + " people report to " + user.getName() + " (" + names + "). Reassign them to another manager first.");
        }
        shopRepository.unassignOfficer(id);
        messageRepository.clearRecipient(id);
        messageRepository.deleteBySenderId(id);
        callLogRepository.deleteByOfficerId(id);
        salesOrderRepository.deleteByOfficerId(id);
        long removedAttendance = attendanceRepository.deleteByUserId(id);
        auditService.log(admin.getId(), AuditAction.USER_DELETE,
                "Deleted user " + user.getUsername() + " (" + user.getEmployeeCode() + ", " + user.getRole()
                        + ") along with " + removedAttendance + " attendance record(s)", info);
        userRepository.delete(user);
    }

    /**
     * Sets exactly who reports directly to a manager: everyone in memberIds now reports to them, and anyone who
     * reported to them before but is not in the list is left without a manager. Allowed pairs follow the hierarchy:
     * Marketing Manager -> Regional Managers, Regional Manager -> Area Sales Managers, Area Sales Manager -> Sales Officers.
     */
    @Transactional
    public List<UserResponse> assignTeam(AppUserDetails admin, Long managerId, List<Long> memberIds, RequestInfo info) {
        User manager = find(managerId);
        Role memberRole = switch (manager.getRole()) {
            case RSM -> Role.RM;
            case RM -> Role.ASM;
            case ASM -> Role.SO;
            default -> throw ApiException.badRequest("NOT_A_MANAGER",
                    "Only a Marketing Manager, Regional Manager or Area Sales Manager has a team.");
        };
        if (memberIds != null && memberIds.stream().anyMatch(java.util.Objects::isNull)) {   // List.of().contains(null) would throw
            throw ApiException.badRequest("INVALID_MEMBER", "The team list contains an empty id. Reload the page and try again.");
        }
        Set<Long> wanted = new HashSet<>(memberIds == null ? List.of() : memberIds);
        log.info("Team save by admin {}: manager {} ({}, {}) -> members {}", admin.getId(), manager.getId(),
                manager.getEmployeeCode(), manager.getRole(), wanted);
        List<String> added = new ArrayList<>();
        List<String> removed = new ArrayList<>();
        try {
            for (Long id : wanted) {
                User m = find(id);
                if (m.getRole() != memberRole) {
                    throw ApiException.badRequest("WRONG_ROLE", m.getName() + " is not a " + MessageService.ROLE_TITLE.get(memberRole)
                            + " - a " + MessageService.ROLE_TITLE.get(manager.getRole()) + "'s team is made of "
                            + MessageService.ROLE_TITLE.get(memberRole) + "s.");
                }
                if (m.getReportingManager() == null || !m.getReportingManager().getId().equals(managerId)) {
                    m.setReportingManager(resolveManager(managerId, m.getId()));
                    userRepository.save(m);
                    added.add(m.getName());
                }
            }
            for (User m : userRepository.findDirectReports(managerId)) {
                if (!wanted.contains(m.getId()) && m.getRole() == memberRole) {
                    m.setReportingManager(null);
                    userRepository.save(m);
                    removed.add(m.getName());
                }
            }
            if (!added.isEmpty() || !removed.isEmpty()) {
                auditService.log(admin.getId(), AuditAction.TEAM_ASSIGN, "Team of " + manager.getName() + " ("
                        + manager.getEmployeeCode() + "): added " + (added.isEmpty() ? "-" : String.join(", ", added))
                        + "; removed " + (removed.isEmpty() ? "-" : String.join(", ", removed)), info);
            }
            userRepository.flush();   // push the UPDATEs now so a database error is caught (and logged) here, not at commit
        } catch (DataAccessException e) {
            Throwable root = NestedExceptionUtils.getMostSpecificCause(e);
            log.error("Team save FAILED for manager {} ({}), members {}, added {}, removed {}: {} - {}", managerId,
                    manager.getEmployeeCode(), wanted, added, removed, root.getClass().getSimpleName(), root.getMessage(), e);
            throw e;
        }
        return userRepository.findDirectReports(managerId).stream().map(UserResponse::from).toList();
    }

    // ---- helpers ----

    private User find(Long id) {
        return userRepository.findById(id).orElseThrow(() -> ApiException.notFound("User not found."));
    }

    private User resolveManager(Long managerId, Long selfId) {
        if (managerId == null) {
            return null;
        }
        if (managerId.equals(selfId)) {
            throw ApiException.badRequest("INVALID_MANAGER", "A person cannot report to themselves.");
        }
        User manager = userRepository.findById(managerId)
                .orElseThrow(() -> ApiException.badRequest("INVALID_MANAGER", "The chosen manager does not exist."));
        // Refuse a manager who (directly or indirectly) already reports to this user - that would be a cycle.
        if (selfId != null) {
            User cursor = manager;
            int guard = 0;
            while (cursor != null && guard++ < 50) {
                if (selfId.equals(cursor.getId())) {
                    throw ApiException.badRequest("INVALID_MANAGER", "That would create a reporting loop.");
                }
                cursor = cursor.getReportingManager();
            }
        }
        return manager;
    }

    private String nextEmployeeCode(Role role) {
        long n = userRepository.countByRole(role) + 1;
        String code;
        do {
            code = String.format("%s%03d", role.codePrefix(), n++);
        } while (userRepository.existsByEmployeeCodeIgnoreCase(code));
        return code;
    }

    private static String describe(User u) {
        return "name=" + u.getName() + ", role=" + u.getRole() + ", area=" + u.getArea()
                + ", managerId=" + (u.getReportingManager() == null ? null : u.getReportingManager().getId());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
