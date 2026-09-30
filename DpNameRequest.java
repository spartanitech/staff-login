package com.spartan.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DpNameRequest(@NotBlank(message = "DP name is required") @Size(max = 150) String name) {
}
