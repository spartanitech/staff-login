package com.spartan.attendance.controller;

import com.spartan.attendance.dto.AttendanceResponse;
import com.spartan.attendance.dto.CorrectionRequest;
import com.spartan.attendance.dto.SettingsResponse;
import com.spartan.attendance.entity.AttendanceStatus;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.AttendanceService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Everything under /api/admin/** is ADMIN-only - enforced by the URL rule in SecurityConfig AND by @PreAuthorize here. */
@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "Reports", description = "Admin-wide attendance report, corrections and policy")
public class AdminAttendanceController {

    private final AttendanceService service;

    @Operation(summary = "All attendance, with filters: date range, employee, role, status, work location (includes device/IP)")
    @GetMapping("/attendance")
    public List<AttendanceResponse> list(@AuthenticationPrincipal AppUserDetails caller,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                         @RequestParam(required = false) Long userId,
                                         @RequestParam(required = false) Role role,
                                         @RequestParam(required = false) AttendanceStatus status,
                                         @RequestParam(required = false) Long workLocationId) {
        return service.report(caller, from, to, userId, role, status, workLocationId);
    }

    @Operation(summary = "Correct an existing attendance record. A reason is mandatory and the change is written to the audit log.")
    @PutMapping("/attendance/{id}")
    public AttendanceResponse correct(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                      @Valid @RequestBody CorrectionRequest request, HttpServletRequest http) {
        return service.correct(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Manually add attendance for a day that has no record (userId + date required, reason mandatory, audited)")
    @PostMapping("/attendance")
    @ResponseStatus(HttpStatus.CREATED)
    public AttendanceResponse createManual(@AuthenticationPrincipal AppUserDetails caller,
                                           @Valid @RequestBody CorrectionRequest request, HttpServletRequest http) {
        return service.createManual(caller, request, RequestInfo.from(http));
    }

    @Operation(summary = "The attendance policy currently in force (shift start, grace, half-day, GPS accuracy, timezone)")
    @GetMapping("/settings")
    public SettingsResponse settings() {
        return service.settings();
    }
}
