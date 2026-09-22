package com.spartan.attendance.security;

import com.spartan.attendance.dto.ApiError;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

/** 401 as JSON. The code tells the frontend WHY: missing token, expired token, invalid token or inactive account. */
@Component
@RequiredArgsConstructor
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException ex)
            throws IOException {
        Object reason = request.getAttribute(JwtAuthFilter.AUTH_ERROR_ATTR);
        String code = reason == null ? "UNAUTHENTICATED" : reason.toString();
        String message = switch (code) {
            case "TOKEN_EXPIRED" -> "Your session has expired. Please sign in again.";
            case "TOKEN_INVALID" -> "Your session is not valid. Please sign in again.";
            case "ACCOUNT_INACTIVE" -> "This account is inactive. Ask your Admin to enable it.";
            default -> "Please sign in to continue.";
        };
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(),
                ApiError.of(HttpStatus.UNAUTHORIZED, code, message, request.getRequestURI(), null));
    }
}
