package com.spartan.attendance.controller;

import com.spartan.attendance.dto.PasswordResetRequest;
import com.spartan.attendance.dto.StatusRequest;
import com.spartan.attendance.dto.UserCreateRequest;
import com.spartan.attendance.dto.UserResponse;
import com.spartan.attendance.dto.UserUpdateRequest;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.service.UserService;
import com.spartan.attendance.util.RequestInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
@Tag(name = "Users", description = "Staff / user management (writes are ADMIN only; reads are limited to your reporting tree)")
public class UserController {

    private final UserService userService;

    @Operation(summary = "List users you are allowed to see")
    @GetMapping
    public List<UserResponse> list(@AuthenticationPrincipal AppUserDetails caller) {
        return userService.list(caller);
    }

    @Operation(summary = "Get one user (must be inside your scope)")
    @GetMapping("/{id}")
    public UserResponse get(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id) {
        return userService.get(caller, id);
    }

    @Operation(summary = "Create a user (ADMIN). The password is BCrypt-hashed.")
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UserResponse create(@AuthenticationPrincipal AppUserDetails caller, @Valid @RequestBody UserCreateRequest request,
                               HttpServletRequest http) {
        return userService.create(caller, request, RequestInfo.from(http));
    }

    @Operation(summary = "Update a user's profile, role and reporting manager (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PutMapping("/{id}")
    public UserResponse update(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                               @Valid @RequestBody UserUpdateRequest request, HttpServletRequest http) {
        return userService.update(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Activate / deactivate a user (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PatchMapping("/{id}/status")
    public UserResponse setStatus(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                  @Valid @RequestBody StatusRequest request, HttpServletRequest http) {
        return userService.setStatus(caller, id, request, RequestInfo.from(http));
    }

    @Operation(summary = "Set a new password for a user (ADMIN)")
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping("/{id}/reset-password")
    public ResponseEntity<Void> resetPassword(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                              @Valid @RequestBody PasswordResetRequest request, HttpServletRequest http) {
        userService.resetPassword(caller, id, request, RequestInfo.from(http));
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Permanently delete a staff account (ADMIN). Their attendance history goes with them; "
            + "refused if anyone still reports to them or they are the last active Admin.")
    @PreAuthorize("hasRole('ADMIN')")
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal AppUserDetails caller, @PathVariable Long id,
                                       HttpServletRequest http) {
        userService.delete(caller, id, RequestInfo.from(http));
        return ResponseEntity.noContent().build();
    }
}
