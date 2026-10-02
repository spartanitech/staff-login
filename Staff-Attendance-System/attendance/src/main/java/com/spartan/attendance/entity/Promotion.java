package com.spartan.attendance.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * One row of the Marketing Manager's Promotions screen (offer, coupon, festival offer, combo offer or a
 * discount-report line). kind "_init" is a single marker row: it records that the starting list was
 * imported once, so deleting every promotion does not bring the starting list back.
 */
@Entity
@Table(name = "promotions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Promotion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 20)
    private String kind;

    @Column(length = 150)
    private String name;

    @Column(length = 60)
    private String code;

    @Column(length = 40)
    private String type;

    @Column(length = 60)
    private String discount;

    @Column(name = "valid_till", length = 40)
    private String validTill;

    private Double price;

    private Double mrp;

    private Integer redemptions;

    @Column(name = "total_discount")
    private Double totalDiscount;

    /** Client-generated id, so a promotion re-sent after a network error is stored only once. */
    @Column(name = "client_ref", length = 64, unique = true)
    private String clientRef;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
