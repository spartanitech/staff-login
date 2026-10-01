package com.spartan.attendance.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One "Call" tap on the Telephone Call Report: which officer called which shop, and when (IST). */
@Entity
@Table(name = "call_logs", indexes = {
        @Index(name = "ix_call_log_officer_date", columnList = "officer_id, call_date")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CallLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false, foreignKey = @ForeignKey(name = "fk_call_log_officer"))
    private User officer;

    @Column(name = "shop_name", nullable = false, length = 150)
    private String shopName;

    @Column(length = 20)
    private String mobile;

    @Column(name = "call_date", nullable = false)
    private LocalDate callDate;

    /** When the call was made (IST), as reported by the phone - so a call logged offline keeps its real time. */
    @Column(name = "called_at", nullable = false)
    private LocalDateTime calledAt;

    /** Client-generated id, so a call that is re-sent after a network error is stored only once. */
    @Column(name = "client_ref", length = 64, unique = true)
    private String clientRef;
}
