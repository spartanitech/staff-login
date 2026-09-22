package com.spartan.attendance.controller;

import com.spartan.attendance.dto.AuditLogResponse;
import com.spartan.attendance.dto.PageResponse;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.service.AuditService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/audit-logs")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "Audit logs", description = "Append-only history of logins, attendance and admin actions (ADMIN only)")
public class AuditLogController {

    private final AuditService auditService;

    @Operation(summary = "Search the audit log (newest first)")
    @GetMapping
    public PageResponse<AuditLogResponse> search(
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) AuditAction action,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return auditService.search(userId, action, from, to, page, size);
    }
}
