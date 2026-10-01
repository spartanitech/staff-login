package com.spartan.attendance.dto;

import com.spartan.attendance.entity.PortalMessage;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/** Same shape the screens already use: {id, from, fromRole, to, text, at}. "at" is an ISO-8601 UTC instant. */
public record MessageResponse(Long id, Long fromId, String from, String fromRole, String to, Long toId, String text,
                              String at, LocalDateTime updatedAt) {

    public static MessageResponse from(PortalMessage m) {
        String at = m.getCreatedAt().atZone(com.spartan.attendance.util.TimeUtil.IST)
                .withZoneSameInstant(ZoneOffset.UTC).format(DateTimeFormatter.ISO_INSTANT);
        return new MessageResponse(m.getId(), m.getSender().getId(), m.getSenderName(), m.getSenderRole(), m.getToKey(),
                m.getRecipient() == null ? null : m.getRecipient().getId(), m.getText(), at, m.getUpdatedAt());
    }
}
