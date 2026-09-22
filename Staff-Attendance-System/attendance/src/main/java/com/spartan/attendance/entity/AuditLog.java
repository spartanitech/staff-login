package com.spartan.attendance.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "audit_logs",
        indexes = {@Index(name = "idx_audit_ts", columnList = "timestamp"),
                @Index(name = "idx_audit_user", columnList = "user_id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Actor. Null for a failed login against an unknown username. Plain id (no FK) so history survives user changes. */
    @Column(name = "user_id")
    private Long userId;

    /**
     * Stored as plain text (not a database ENUM column) so adding an AuditAction never needs a schema change.
     * SchemaMigrator converts a column an older version created as ENUM.
     */
    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 40)
    private AuditAction action;

    @Column(length = 1000)
    private String description;

    @Column(name = "ip_address", length = 64)
    private String ipAddress;

    @Column(name = "user_agent", length = 255)
    private String userAgent;

    @Column(nullable = false)
    private LocalDateTime timestamp;
}
