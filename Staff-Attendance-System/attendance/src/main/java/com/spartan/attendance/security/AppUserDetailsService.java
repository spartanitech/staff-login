package com.spartan.attendance.security;

import com.spartan.attendance.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AppUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        return userRepository.findByUsernameIgnoreCase(username)
                .map(AppUserDetails::new)
                .orElseThrow(() -> new UsernameNotFoundException("No such user"));
    }

    public AppUserDetails loadById(Long id) {
        return userRepository.findById(id).map(AppUserDetails::new).orElse(null);
    }
}
