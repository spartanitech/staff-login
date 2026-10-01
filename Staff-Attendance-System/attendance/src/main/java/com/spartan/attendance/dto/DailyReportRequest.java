package com.spartan.attendance.dto;

import jakarta.validation.constraints.NotNull;
import java.util.Map;

/** The whole Daily Shop Report of one day, as the form holds it. */
public record DailyReportRequest(
        @NotNull(message = "header is required") Map<String, Object> header,
        @NotNull(message = "rows are required") Map<String, Object> rows) {
}
