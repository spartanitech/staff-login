package com.spartan.attendance.entity;

import com.spartan.attendance.util.TimeUtil;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "users",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_users_username", columnNames = "username"),
                @UniqueConstraint(name = "uk_users_employee_code", columnNames = "employee_code")},
        indexes = @Index(name = "idx_users_manager", columnList = "reporting_manager_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "employee_code", nullable = false, length = 32)
    private String employeeCode;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 64)
    private String username;

    /** BCrypt hash. The plaintext password is never stored anywhere. */
    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    @Column(length = 150)
    private String email;

    @Column(length = 20)
    private String phone;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Role role;

    @Column(length = 80)
    private String designation;

    /** City / work area (mirrors the Area field of the existing Admin staff cards). */
    @Column(length = 80)
    private String area;

    @Column(length = 80)
    private String region;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reporting_manager_id", foreignKey = @ForeignKey(name = "fk_users_manager"))
    private User reportingManager;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        LocalDateTime now = TimeUtil.nowIst();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = TimeUtil.nowIst();
    }
}
