package com.spartan.attendance.entity;

import com.spartan.attendance.util.TimeUtil;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A retail shop a Sales Officer visits. The Admin owns the shop's location and who it is assigned to; a Sales Officer
 * marks attendance by standing within {@link #allowedRadiusMeters} of one of the shops assigned to them.
 */
@Entity
@Table(name = "shops",
        uniqueConstraints = @UniqueConstraint(name = "uk_shops_code", columnNames = "code"),
        indexes = @Index(name = "idx_shops_officer", columnList = "assigned_officer_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Shop {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 32)
    private String code;

    @Column(nullable = false, length = 150)
    private String name;

    @Column(length = 120)
    private String locality;

    @Column(length = 80)
    private String region;

    /** City / area the shop is in (e.g. Chennai). Set by the ASM so the officer's list can be filtered by city. */
    @Column(length = 80)
    private String city;

    @Column(length = 255)
    private String address;

    @Column(length = 20)
    private String phone;

    @Column(nullable = false)
    private double latitude;

    @Column(nullable = false)
    private double longitude;

    @Column(name = "allowed_radius_meters", nullable = false)
    private int allowedRadiusMeters;

    /** The Sales Officer this shop is assigned to (null = not assigned yet, nobody can check in there). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assigned_officer_id", foreignKey = @ForeignKey(name = "fk_shops_officer"))
    private User assignedOfficer;

    /** Who added the shop: the Admin, or the Area Sales Manager (or other manager) who added it for their team. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_id", foreignKey = @ForeignKey(name = "fk_shops_created_by"))
    private User createdBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status;

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
