package com.spartan.attendance.dto;

import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.AuditLog;
import java.time.LocalDateTime;

public record AuditLogResponse(Long id, Long userId, String userName, AuditAction action, String description,
                               String ipAddress, String userAgent, LocalDateTime timestamp) {

    public static AuditLogResponse from(AuditLog l, String userName) {
        return new AuditLogResponse(l.getId(), l.getUserId(), userName, l.getAction(), l.getDescription(),
                l.getIpAddress(), l.getUserAgent(), l.getTimestamp());
    }
}
