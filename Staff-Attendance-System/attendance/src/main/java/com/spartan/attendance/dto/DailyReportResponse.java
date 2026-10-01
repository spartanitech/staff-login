package com.spartan.attendance.dto;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** updatedAt is null when nothing has been saved for that day yet. */
public record DailyReportResponse(Long officerId, LocalDate date, Map<String, Object> header, Map<String, Object> rows,
                                  LocalDateTime updatedAt) {
}
