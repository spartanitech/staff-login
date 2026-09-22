package com.spartan.attendance.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    public static final String AUTH_ERROR_ATTR = "sp.auth.error";

    private final JwtService jwtService;
    private final AppUserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ") && SecurityContextHolder.getContext().getAuthentication() == null) {
            String token = header.substring(7).trim();
            try {
                Claims claims = jwtService.parse(token);
                AppUserDetails principal = userDetailsService.loadById(Long.valueOf(claims.getSubject()));
                if (principal == null || !principal.isEnabled()) {
                    request.setAttribute(AUTH_ERROR_ATTR, "ACCOUNT_INACTIVE");
                } else {
                    UsernamePasswordAuthenticationToken auth =
                            new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (ExpiredJwtException e) {
                request.setAttribute(AUTH_ERROR_ATTR, "TOKEN_EXPIRED");
            } catch (JwtException | IllegalArgumentException e) {
                request.setAttribute(AUTH_ERROR_ATTR, "TOKEN_INVALID");
            }
        }
        chain.doFilter(request, response);
    }
}
