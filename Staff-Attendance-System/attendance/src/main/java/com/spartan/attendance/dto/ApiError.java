package com.spartan.attendance.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDateTime;
import java.util.Map;
import org.springframework.http.HttpStatus;
import com.spartan.attendance.util.TimeUtil;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(LocalDateTime timestamp, int status, String error, String code, String message,
                       String path, Map<String, Object> details) {

    public static ApiError of(HttpStatus status, String code, String message, String path, Map<String, Object> details) {
        return new ApiError(TimeUtil.nowIst(), status.value(), status.getReasonPhrase(), code, message, path, details);
    }
}
