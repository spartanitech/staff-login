package com.spartan.attendance.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One shop a Sales Officer visited, proven the same way as the day's check-in: inside the shop's radius, with a good
 * GPS fix and a live photo. The first visit of the day is also the attendance check-in (attendanceId points at it);
 * every later shop adds another row here, so two, three or ten shops in a day are all recorded and synced.
 *
 * Shop id/name are plain columns (no foreign key) so deleting a shop keeps its visit history.
 */
@Entity
@Table(name = "shop_visits",
        indexes = {@Index(name = "idx_shop_visit_officer_date", columnList = "officer_id,visit_date"),
                @Index(name = "idx_shop_visit_date", columnList = "visit_date")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShopVisit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false, foreignKey = @ForeignKey(name = "fk_shop_visit_officer"))
    private User officer;

    /** The day's attendance record this visit belongs to. */
    @Column(name = "attendance_id")
    private Long attendanceId;

    @Column(name = "shop_id")
    private Long shopId;

    @Column(name = "shop_name", nullable = false, length = 150)
    private String shopName;

    @Column(name = "visit_date", nullable = false)
    private LocalDate visitDate;

    @Column(name = "visit_time", nullable = false)
    private LocalDateTime visitTime;

    @Column(nullable = false)
    private double latitude;

    @Column(nullable = false)
    private double longitude;

    @Column(nullable = false)
    private double accuracy;

    @Column(name = "distance_meters", nullable = false)
    private double distanceMeters;

    @Column(name = "allowed_radius_meters", nullable = false)
    private int allowedRadiusMeters;

    /** File name of the live photo (the first visit shares the check-in photo). */
    @Column(length = 120)
    private String photo;

    /** true for the visit that was also the day's attendance check-in. */
    @Column(name = "first_of_day", nullable = false)
    private boolean firstOfDay;
}
