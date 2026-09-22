package com.spartan.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Note: no role field. The role is whatever the database says - never something the client claims. */
public record LoginRequest(
        @NotBlank(message = "Username is required") @Size(max = 64) String username,
        @NotBlank(message = "Password is required") @Size(max = 128) String password) {
}
