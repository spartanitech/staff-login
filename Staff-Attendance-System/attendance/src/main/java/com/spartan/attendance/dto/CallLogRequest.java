package com.spartan.attendance.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** at: when the call was made (ISO instant from the phone; server time if missing). ref: client id for de-duplication. */
public record CallLogRequest(
        @NotBlank(message = "Shop name is required") @Size(max = 150) String shop,
        @Size(max = 20) String mobile,
        Instant at,
        @Size(max = 64) String ref) {
}
