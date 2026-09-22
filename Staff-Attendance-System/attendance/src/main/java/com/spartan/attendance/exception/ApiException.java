package com.spartan.attendance.exception;

import java.util.Map;
import org.springframework.http.HttpStatus;

/** Business-rule failure with a stable machine-readable code the frontend can switch on. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;
    private final transient Map<String, Object> details;

    public ApiException(HttpStatus status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }

    public static ApiException badRequest(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message, null);
    }

    public static ApiException badRequest(String code, String message, Map<String, Object> details) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message, details);
    }

    public static ApiException unauthorized(String code, String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, code, message, null);
    }

    public static ApiException forbidden(String code, String message) {
        return new ApiException(HttpStatus.FORBIDDEN, code, message, null);
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", message, null);
    }

    public static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message, null);
    }
}
