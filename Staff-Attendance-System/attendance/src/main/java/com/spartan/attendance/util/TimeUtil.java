package com.spartan.attendance.util;

import java.time.LocalDateTime;
import java.time.ZoneId;

public final class TimeUtil {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private TimeUtil() {
    }

    public static LocalDateTime nowIst() {
        return LocalDateTime.now(IST);
    }
}
