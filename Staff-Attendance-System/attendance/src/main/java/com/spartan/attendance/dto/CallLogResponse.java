package com.spartan.attendance.dto;

import com.spartan.attendance.entity.CallLog;
import com.spartan.attendance.util.TimeUtil;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** date / time are pre-formatted the way the Telephone Call Report shows them ("01 Oct 2026", "11:40 am"). */
public record CallLogResponse(Long id, Long officerId, String officerName, String shop, String mobile,
                              LocalDate callDate, String date, String time, String at, String ref) {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("hh:mm a", Locale.ENGLISH);

    public static CallLogResponse from(CallLog c) {
        String at = c.getCalledAt().atZone(TimeUtil.IST).withZoneSameInstant(ZoneOffset.UTC).format(DateTimeFormatter.ISO_INSTANT);
        return new CallLogResponse(c.getId(), c.getOfficer().getId(), c.getOfficer().getName(), c.getShopName(), c.getMobile(),
                c.getCallDate(), c.getCalledAt().format(DATE), c.getCalledAt().format(TIME).toLowerCase(Locale.ENGLISH), at,
                c.getClientRef());
    }
}
