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
 * One product's stock for one Sales Officer on one day.
 * closing = opening + receipt - soSales - dpSales, and the next day's opening is always this day's closing.
 */
@Entity
@Table(name = "stock_entries",
        uniqueConstraints = @UniqueConstraint(name = "uk_stock_officer_date_product",
                columnNames = {"officer_id", "entry_date", "product"}),
        indexes = @Index(name = "idx_stock_officer_date", columnList = "officer_id, entry_date"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false, foreignKey = @ForeignKey(name = "fk_stock_officer"))
    private User officer;

    @Column(name = "entry_date", nullable = false)
    private LocalDate entryDate;

    @Column(nullable = false, length = 150)
    private String product;

    @Column(length = 60)
    private String category;

    @Column(nullable = false)
    private int opening;

    @Column(nullable = false)
    private int receipt;

    @Column(name = "so_sales", nullable = false)
    private int soSales;

    @Column(name = "dp_sales", nullable = false)
    private int dpSales;

    @Column(nullable = false)
    private int closing;

    /** Price per unit (Rs) at the time of entry, so sales value can be shown against the target. */
    @Column(name = "unit_price", nullable = false)
    private double unitPrice;

    @Column(name = "dp_name", length = 150)
    private String dpName;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = TimeUtil.nowIst();
    }
}
