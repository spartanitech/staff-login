package com.spartan.attendance.entity;

import com.spartan.attendance.util.TimeUtil;
import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One row per user per IST calendar day (enforced by a unique constraint, not just by application code). */
@Entity
@Table(name = "attendance",
        uniqueConstraints = @UniqueConstraint(name = "uk_attendance_user_date", columnNames = {"user_id", "attendance_date"}),
        indexes = @Index(name = "idx_attendance_date", columnList = "attendance_date"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Attendance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, foreignKey = @ForeignKey(name = "fk_attendance_user"))
    private User user;

    @Column(name = "attendance_date", nullable = false)
    private LocalDate attendanceDate;

    @Column(name = "check_in_time")
    private LocalDateTime checkInTime;

    @Column(name = "check_out_time")
    private LocalDateTime checkOutTime;

    @Column(name = "check_in_latitude")
    private Double checkInLatitude;

    @Column(name = "check_in_longitude")
    private Double checkInLongitude;

    @Column(name = "check_out_latitude")
    private Double checkOutLatitude;

    @Column(name = "check_out_longitude")
    private Double checkOutLongitude;

    @Column(name = "check_in_accuracy")
    private Double checkInAccuracy;

    @Column(name = "check_out_accuracy")
    private Double checkOutAccuracy;

    /** Server-computed Haversine distance to the matched work location at check-in / check-out. */
    @Column(name = "check_in_distance_meters")
    private Double checkInDistanceMeters;

    @Column(name = "check_out_distance_meters")
    private Double checkOutDistanceMeters;

    @Column(name = "total_working_minutes")
    private Integer totalWorkingMinutes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AttendanceStatus status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "work_location_id", foreignKey = @ForeignKey(name = "fk_attendance_location"))
    private WorkLocation workLocation;

    /** Set for Sales Officers: the shop they marked attendance at (they check in at a shop, not at a work location). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "shop_id", foreignKey = @ForeignKey(name = "fk_attendance_shop"))
    private Shop shop;

    /** File name of the live photo taken at the shop (see PhotoStorage). Null when no photo was taken. */
    @Column(name = "check_in_photo", length = 80)
    private String checkInPhoto;

    @Column(name = "device_info", length = 255)
    private String deviceInfo;

    @Column(name = "ip_address", length = 64)
    private String ipAddress;

    /** Set only when an Admin corrected the record - corrections are never silent. */
    @Column(name = "correction_reason", length = 500)
    private String correctionReason;

    @Column(name = "corrected_by")
    private Long correctedBy;

    @Column(name = "corrected_at")
    private LocalDateTime correctedAt;

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
