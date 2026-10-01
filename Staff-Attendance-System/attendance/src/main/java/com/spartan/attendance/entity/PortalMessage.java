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
 * One message on the portal's shared message board. It is addressed one of three ways, exactly as the screens do it:
 *   "all"                 everyone
 *   a role title          e.g. "Area Sales Manager" - everyone in that role
 *   "person:&lt;name&gt;"       one named person (recipient is resolved to their account when the name is known)
 */
@Entity
@Table(name = "portal_messages", indexes = {
        @Index(name = "ix_portal_msg_created", columnList = "created_at"),
        @Index(name = "ix_portal_msg_sender", columnList = "sender_id"),
        @Index(name = "ix_portal_msg_recipient", columnList = "recipient_id")})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PortalMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sender_id", nullable = false, foreignKey = @ForeignKey(name = "fk_portal_msg_sender"))
    private User sender;

    /** Name shown as "from" (the sender's name at the time of sending). */
    @Column(name = "sender_name", nullable = false, length = 120)
    private String senderName;

    /** Role title shown as "from role", e.g. "Sales Officer". */
    @Column(name = "sender_role", nullable = false, length = 40)
    private String senderRole;

    /** "all", a role title, or "person:Name". */
    @Column(name = "to_key", nullable = false, length = 160)
    private String toKey;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recipient_id", foreignKey = @ForeignKey(name = "fk_portal_msg_recipient"))
    private User recipient;

    @Column(nullable = false, length = 2000)
    private String text;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = TimeUtil.nowIst();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = TimeUtil.nowIst();
    }
}
