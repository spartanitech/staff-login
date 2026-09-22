package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Role;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Full replacement of the editable profile fields (PUT). reportingManagerId = null clears the manager. */
public record UserUpdateRequest(
        @NotBlank(message = "Name is required") @Size(max = 120) String name,
        @NotBlank(message = "Username is required")
        @Pattern(regexp = "^[A-Za-z0-9._@-]{3,64}$", message = "Username must be 3-64 characters: letters, digits, . _ @ -") String username,
        @NotNull(message = "Role is required") Role role,
        @Email(message = "Email is not valid") @Size(max = 150) String email,
        @Size(max = 20) String phone,
        @Size(max = 80) String designation,
        @Size(max = 80) String area,
        @Size(max = 80) String region,
        Long reportingManagerId) {
}
