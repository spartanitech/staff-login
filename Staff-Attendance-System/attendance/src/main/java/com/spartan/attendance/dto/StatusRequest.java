package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Status;
import jakarta.validation.constraints.NotNull;

public record StatusRequest(@NotNull(message = "Status is required") Status status) {
}
