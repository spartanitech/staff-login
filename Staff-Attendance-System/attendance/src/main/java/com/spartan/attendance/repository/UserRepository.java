package com.spartan.attendance.repository;

import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsernameIgnoreCase(String username);

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByEmployeeCodeIgnoreCase(String employeeCode);

    long countByRoleAndStatus(Role role, Status status);

    long countByRole(Role role);

    /** (userId, managerId) pairs for everyone who has a manager - one query builds the whole reporting tree. */
    @Query("select u.id, u.reportingManager.id from User u where u.reportingManager is not null")
    List<Object[]> findManagerLinks();

    @Query("select u from User u left join fetch u.reportingManager order by u.name")
    List<User> findAllWithManager();

    @Query("select u from User u left join fetch u.reportingManager where u.id = :id")
    Optional<User> findByIdWithManager(@Param("id") Long id);

    @Query("select u from User u where u.reportingManager.id = :managerId")
    List<User> findDirectReports(@Param("managerId") Long managerId);
}