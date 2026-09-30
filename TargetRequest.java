package com.spartan.attendance.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record TargetRequest(
        @NotNull(message = "officerId is required") Long officerId,
        @NotNull(message = "month is required") @Pattern(regexp = "^\\d{4}-(0[1-9]|1[0-2])$", message = "month must look like 2026-09") String month,
        @NotNull(message = "amount is required") @Min(value = 0, message = "Target cannot be negative")
        @Max(value = 100000000000L, message = "Target is too large") Long amount) {
}
