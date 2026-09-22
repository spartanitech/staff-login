package com.spartan.attendance.service;

import com.spartan.attendance.dto.ChangePasswordRequest;
import com.spartan.attendance.dto.LoginRequest;
import com.spartan.attendance.dto.LoginResponse;
import com.spartan.attendance.dto.UserResponse;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.security.JwtService;
import com.spartan.attendance.util.RequestInfo;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final AuthenticationManager authenticationManager;
    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;

    // Deliberately NOT @Transactional: the audit row for a failed login must be committed even though we then throw.
    public LoginResponse login(LoginRequest req, RequestInfo info) {
        String username = req.username().trim();
        Authentication auth;
        try {
            // DaoAuthenticationProvider: loads the user, checks enabled/status, BCrypt-verifies the password
            auth = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(username, req.password()));
        } catch (DisabledException e) {
            Long id = userRepository.findByUsernameIgnoreCase(username).map(User::getId).orElse(null);
            auditService.log(id, AuditAction.LOGIN_FAILED, "Login refused: account is inactive (" + username + ")", info);
            throw ApiException.unauthorized("ACCOUNT_INACTIVE", "This account is inactive. Ask your Admin to enable it.");
        } catch (AuthenticationException e) {
            Long id = userRepository.findByUsernameIgnoreCase(username).map(User::getId).orElse(null);
            auditService.log(id, AuditAction.LOGIN_FAILED, "Login failed: wrong username or password (" + username + ")", info);
            throw ApiException.unauthorized("INVALID_CREDENTIALS", "Incorrect username or password.");
        }
        AppUserDetails principal = (AppUserDetails) auth.getPrincipal();
        User user = userRepository.findByIdWithManager(principal.getId()).orElseThrow();
        auditService.log(user.getId(), AuditAction.LOGIN, "Signed in as " + user.getRole(), info);
        return new LoginResponse(jwtService.generate(user), "Bearer", jwtService.expiresInSeconds(), UserResponse.from(user));
    }

    public void logout(AppUserDetails caller, RequestInfo info) {
        auditService.log(caller.getId(), AuditAction.LOGOUT, "Signed out", info);
    }

    @Transactional(readOnly = true)
    public UserResponse me(AppUserDetails caller) {
        return UserResponse.from(userRepository.findByIdWithManager(caller.getId()).orElseThrow());
    }

    @Transactional
    public void changePassword(AppUserDetails caller, ChangePasswordRequest req, RequestInfo info) {
        User user = userRepository.findById(caller.getId()).orElseThrow();
        if (!passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw ApiException.badRequest("WRONG_CURRENT_PASSWORD", "Your current password is not correct.");
        }
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        userRepository.save(user);
        auditService.log(user.getId(), AuditAction.PASSWORD_CHANGE, "Changed own password", info);
    }
}
