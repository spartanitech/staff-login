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

/**
 * One Sales Officer's Daily Shop Report for one day: the header (HQ, town, beat, KM, expenses, the three photos) and
 * the per-shop rows (type, location, mobile, quantities, value, remarks). Both are kept as JSON exactly as the form
 * has them, so the paper-form layout can change without a schema change.
 */
@Entity
@Table(name = "daily_reports",
        uniqueConstraints = @UniqueConstraint(name = "uk_daily_report_officer_date", columnNames = {"officer_id", "report_date"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DailyReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false, foreignKey = @ForeignKey(name = "fk_daily_report_officer"))
    private User officer;

    @Column(name = "report_date", nullable = false)
    private LocalDate reportDate;

    /** JSON object: the form header (may include small JPEG data URLs of the KM / ticket photos). */
    @Lob
    @Column(name = "header_json")
    private String headerJson;

    /** JSON object: shop name -> that shop's row. */
    @Lob
    @Column(name = "rows_json")
    private String rowsJson;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = TimeUtil.nowIst();
    }
}
