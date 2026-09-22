package com.spartan.attendance.security;

import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import java.util.Collection;
import java.util.List;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/**
 * The authenticated principal. The single authority is "ROLE_" + Role name (e.g. ROLE_ADMIN), so
 * hasRole('ADMIN') is the only spelling that ever appears in a security rule.
 */
public class AppUserDetails implements UserDetails {

    private final Long id;
    private final String username;
    private final String passwordHash;
    private final Role role;
    private final Status status;

    public AppUserDetails(User u) {
        this.id = u.getId();
        this.username = u.getUsername();
        this.passwordHash = u.getPasswordHash();
        this.role = u.getRole();
        this.status = u.getStatus();
    }

    public Long getId() {
        return id;
    }

    public Role getRole() {
        return role;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    /** ENABLED == (status is ACTIVE). An INACTIVE user cannot log in and their old tokens stop working at once. */
    @Override
    public boolean isEnabled() {
        return status == Status.ACTIVE;
    }
}
