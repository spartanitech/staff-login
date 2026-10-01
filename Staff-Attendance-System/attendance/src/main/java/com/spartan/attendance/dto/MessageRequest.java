package com.spartan.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** to: "all", a role title (e.g. "Sales Officer") or "person:Name". fromRole: optional display role (Admin viewing as someone). */
public record MessageRequest(
        @NotBlank(message = "Choose who the message is for") @Size(max = 160) String to,
        @NotBlank(message = "Type a message first") @Size(max = 2000, message = "Message is too long (2000 characters max)") String text) {
}
