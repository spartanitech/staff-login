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
 * An order a Sales Officer booked at a shop. Saved on the server the moment the officer confirms it, so the Area Sales
 * Manager (and the managers above) and the Admin see it straight away. Booking an order does NOT mark attendance:
 * attendance is only ever recorded by the shop check-in (GPS + live photo).
 *
 * The items are kept as JSON exactly as the order form has them (name, category, price, qty), and status is plain
 * text rather than a MySQL ENUM so new statuses never need a schema change.
 */
@Entity
@Table(name = "sales_orders",
        uniqueConstraints = @UniqueConstraint(name = "uk_sales_order_officer_ref", columnNames = {"officer_id", "client_ref"}),
        indexes = @Index(name = "idx_sales_order_date", columnList = "order_date"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SalesOrder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false, foreignKey = @ForeignKey(name = "fk_sales_order_officer"))
    private User officer;

    /** Made by the phone (officer + day + shop), so re-sending the same order after a dropped connection updates it. */
    @Column(name = "client_ref", nullable = false, length = 100)
    private String clientRef;

    @Column(name = "order_date", nullable = false)
    private LocalDate orderDate;

    /** The server shop id when the order was booked at a server shop (kept as a plain number: deleting a shop keeps its orders). */
    @Column(name = "shop_id")
    private Long shopId;

    @Column(name = "shop_name", nullable = false, length = 150)
    private String shopName;

    /** JSON array of {name, category, price, qty}. */
    @Lob
    @Column(name = "items_json")
    private String itemsJson;

    @Column(name = "item_count", nullable = false)
    private int itemCount;

    @Column(name = "total_amount", nullable = false)
    private double totalAmount;

    @Column(nullable = false, length = 24)
    private String status;

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
