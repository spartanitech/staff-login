package com.spartan.attendance.controller;

import com.spartan.attendance.dto.ChangePasswordRequest;
import com.spartan.attendance.dto.LoginRequest;
import com.spartan.attendance.dto.LoginResponse;
import com.spartan.attendance.dto.UserResponse;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.AuthService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Tag(name = "Authentication", description = "Login, logout, current user")
public class AuthController {

    private final AuthService authService;

    @Operation(summary = "Sign in with username + password (public). The role in the response comes from the database.",
            security = {})
    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        return authService.login(request, RequestInfo.from(http));
    }

    @Operation(summary = "Record a sign-out in the audit log (the client then discards its token)")
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AppUserDetails caller, HttpServletRequest http) {
        authService.logout(caller, RequestInfo.from(http));
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "The signed-in user's profile and role")
    @GetMapping("/me")
    public UserResponse me(@AuthenticationPrincipal AppUserDetails caller) {
        return authService.me(caller);
    }

    @Operation(summary = "Change your own password")
    @PostMapping("/change-password")
    public ResponseEntity<Void> changePassword(@AuthenticationPrincipal AppUserDetails caller,
                                               @Valid @RequestBody ChangePasswordRequest request,
                                               HttpServletRequest http) {
        authService.changePassword(caller, request, RequestInfo.from(http));
        return ResponseEntity.noContent().build();
    }
}
