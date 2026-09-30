package com.spartan.attendance.entity;

import com.spartan.attendance.util.TimeUtil;
import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** The monthly sales target (Rs) a manager (normally the ASM) sets for one person in their team. */
@Entity
@Table(name = "sales_targets",
        uniqueConstraints = @UniqueConstraint(name = "uk_target_officer_month", columnNames = {"officer_id", "target_month"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SalesTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false, foreignKey = @ForeignKey(name = "fk_target_officer"))
    private User officer;

    /** yyyy-MM, e.g. 2026-09 */
    @Column(name = "target_month", nullable = false, length = 7)
    private String month;

    @Column(nullable = false)
    private long amount;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "set_by_id", foreignKey = @ForeignKey(name = "fk_target_set_by"))
    private User setBy;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = TimeUtil.nowIst();
    }
}
