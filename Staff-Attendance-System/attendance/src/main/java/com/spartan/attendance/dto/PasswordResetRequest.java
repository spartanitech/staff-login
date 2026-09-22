package com.spartan.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetRequest(
        @NotBlank(message = "New password is required")
        @Size(min = 8, max = 72, message = "Password must be 8-72 characters") String newPassword) {
}
