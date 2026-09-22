package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Role;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UserCreateRequest(
        @NotBlank(message = "Name is required") @Size(max = 120) String name,
        @NotBlank(message = "Username is required")
        @Pattern(regexp = "^[A-Za-z0-9._@-]{3,64}$", message = "Username must be 3-64 characters: letters, digits, . _ @ -") String username,
        @NotBlank(message = "Password is required")
        @Size(min = 8, max = 72, message = "Password must be 8-72 characters") String password,
        @NotNull(message = "Role is required") Role role,
        @Size(max = 32) String employeeCode,
        @Email(message = "Email is not valid") @Size(max = 150) String email,
        @Size(max = 20) String phone,
        @Size(max = 80) String designation,
        @Size(max = 80) String area,
        @Size(max = 80) String region,
        Long reportingManagerId) {
}
