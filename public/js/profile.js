// Theme toggle functionality
document.addEventListener("DOMContentLoaded", () => {
  // Create Order button handler
  const createOrderBtn = document.getElementById("create-order-btn")
  if (createOrderBtn) {
    createOrderBtn.addEventListener("click", () => {
      window.location.href = "/index.html#order"
    })
  }

  const themeToggle = document.getElementById("themeToggle")
  const htmlElement = document.documentElement

  // Check for saved theme preference
  if (localStorage.getItem("theme") === "light") {
    htmlElement.classList.remove("dark")
    htmlElement.classList.add("light")
    themeToggle.checked = true
  }

  // Toggle theme when switch is clicked
  themeToggle.addEventListener("change", function () {
    if (this.checked) {
      htmlElement.classList.remove("dark")
      htmlElement.classList.add("light")
      localStorage.setItem("theme", "light")
    } else {
      htmlElement.classList.remove("light")
      htmlElement.classList.add("dark")
      localStorage.setItem("theme", "dark")
    }
  })

  // Tab functionality
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      // Remove active class from all tabs
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"))
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"))

      // Add active class to clicked tab
      this.classList.add("active")

      // Show corresponding content
      const tabName = this.getAttribute("data-tab")
      document.getElementById(`tab-${tabName}`).classList.add("active")

      // Load content based on tab
      if (tabName === "orders") {
        loadUserOrders()
      } else if (tabName === "reviews") {
        loadUserReviews()
      } else if (tabName === "profile") {
        // Reload profile data when the profile tab is clicked
        loadUserProfile()
      }
    })
  })

  // Function to get user ID
  function getUserId() {
    const userId = localStorage.getItem("userId")
    if (userId) {
      return userId
    }

    const urlParams = new URLSearchParams(window.location.search)
    const urlUserId = urlParams.get("userId")

    if (urlUserId) {
      localStorage.setItem("userId", urlUserId)
      return urlUserId
    }

    showError("Необхідно авторизуватися")
    setTimeout(() => {
      window.location.href = "/auth.html"
    }, 2000)
    return null
  }

  // Function to get all selected subjects
  function getSelectedSubjects() {
    const checkboxes = document.querySelectorAll('input[name="industry"]:checked')
    return Array.from(checkboxes).map((cb) => cb.value)
  }

  // Function to save selected subjects
  function saveSelectedSubjects() {
    const selectedSubjects = getSelectedSubjects()

    // Save to localStorage as JSON string
    localStorage.setItem("selectedSubjects", JSON.stringify(selectedSubjects))

    // Save to server if user is logged in
    const userId = getUserId()
    if (userId) {
      fetch(`/api/user-selected-subjects/${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          selectedSubjects: selectedSubjects,
        }),
      }).catch((err) => console.error("Failed to save selected subjects to server:", err))
    }

    return selectedSubjects
  }

  // Function to load user profile
  async function loadUserProfile() {
    const userId = getUserId()
    if (!userId) return

    try {
      const response = await fetch(`/profile/${userId}`)

      if (!response.ok) {
        throw new Error("Не вдалося завантажити профіль")
      }

      const data = await response.json()

      if (data.profile) {
        // Update profile header
        updateProfileHeader(data.profile)

        // Update form fields
        document.getElementById("first_name").value = data.profile.first_name || ""
        document.getElementById("last_name").value = data.profile.last_name || ""
        document.getElementById("email").value = data.profile.email || ""
        document.getElementById("phone").value = data.profile.phone || ""
        document.getElementById("address").value = data.profile.address || ""
        if (document.getElementById("bio")) {
          document.getElementById("bio").value = data.profile.bio || ""
        }

        if (data.profile.date_of_birth) {
          const date = new Date(data.profile.date_of_birth)
          const formattedDate = date.toISOString().split("T")[0]
          document.getElementById("date_of_birth").value = formattedDate
        }

        document.getElementById("role_master").checked = data.profile.role_master || false

        // Display approval status if available
        if (data.profile.approval_status) {
          const statusElement = document.getElementById("approval-status")
          if (statusElement) {
            statusElement.textContent = getStatusText(data.profile.approval_status)
            statusElement.className = `status-${data.profile.approval_status}`
            statusElement.style.display = "inline-block"
          }
        }

        // Update notification badge
        if (data.unreadNotifications > 0) {
          const notificationBadge = document.getElementById("notifications-btn")
          if (notificationBadge) {
            notificationBadge.setAttribute("data-count", data.unreadNotifications)
            notificationBadge.classList.add("has-notifications")
          }
        }

        // Update stats
        const ratingValue = document.getElementById("rating-value")
        if (ratingValue) {
          ratingValue.textContent = data.profile.rating || "0.0"
        }

        const reviewsCount = document.getElementById("reviews-count")
        if (reviewsCount) {
          reviewsCount.textContent = data.profile.reviews_count || "0"
        }

        const ordersCount = document.getElementById("orders-count")
        if (ordersCount) {
          ordersCount.textContent = data.ordersCount || "0"
        }

        // Show services section if user is a tutor
        toggleServicesSection(data.profile.role_master)

        // Load user services if tutor
        if (data.profile.role_master) {
          await loadUserServices(userId)

          // After loading services, check for selected subjects
          await loadUserSelectedSubjects()
        }
      }
    } catch (error) {
      showError(error.message)
    }
  }

  // Function to toggle services section
  function toggleServicesSection(isTutor) {
    const servicesDiv = document.getElementById("services")
    if (!servicesDiv) return

    if (isTutor) {
      servicesDiv.style.display = "block"
      setTimeout(() => {
        servicesDiv.classList.add("visible")
      }, 10)
    } else {
      servicesDiv.classList.remove("visible")
      servicesDiv.classList.add("fade-out")
      setTimeout(() => {
        servicesDiv.style.display = "none"
        servicesDiv.classList.remove("fade-out")
      }, 500)

      // Hide all subject skills sections
      document.querySelectorAll(".industry-skills").forEach((section) => {
        section.classList.add("fade-out")
        setTimeout(() => {
          section.classList.remove("visible")
          section.classList.remove("fade-out")
          section.classList.remove("slide-in-right", "slide-in-left", "slide-in-top", "slide-in-bottom")
        }, 400)
      })
    }
  }

  // Function to update profile header
  function updateProfileHeader(profile) {
    // Set profile name
    const profileName = document.getElementById("profile-name")
    if (profileName) {
      profileName.textContent =
        profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : profile.username
    }

    // Set username
    const profileUsername = document.getElementById("profile-username")
    if (profileUsername) {
      profileUsername.textContent = `@${profile.username}`
    }

    // Set avatar initials
    const avatarInitials = document.getElementById("avatar-initials")
    if (avatarInitials) {
      if (profile.first_name && profile.last_name) {
        avatarInitials.textContent = `${profile.first_name.charAt(0)}${profile.last_name.charAt(0)}`
      } else if (profile.username) {
        avatarInitials.textContent = profile.username.charAt(0).toUpperCase()
      }
    }

    // Set avatar image if available
    if (profile.profile_image_url) {
      const avatarImage = document.getElementById("avatar-image")
      if (avatarImage) {
        avatarImage.src = profile.profile_image_url
        avatarImage.style.display = "block"
        if (avatarInitials) {
          avatarInitials.style.display = "none"
        }
      }
    }
  }

  function getStatusText(status) {
    switch (status) {
      case "pending":
        return "На розгляді"
      case "approved":
        return "Затверджено"
      case "rejected":
        return "Відхилено"
      default:
        return ""
    }
  }

  // Function to load user's selected subjects
  async function loadUserSelectedSubjects() {
    try {
      const userId = getUserId()
      if (!userId) return

      // First try to get from localStorage
      let selectedSubjects = []
      const storedSubjects = localStorage.getItem("selectedSubjects")

      if (storedSubjects) {
        try {
          selectedSubjects = JSON.parse(storedSubjects)
        } catch (e) {
          console.error("Error parsing stored subjects:", e)
        }
      }

      // If not in localStorage, try to get from server
      if (selectedSubjects.length === 0) {
        const response = await fetch(`/api/user-selected-subjects/${userId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.selectedSubjects && data.selectedSubjects.length > 0) {
            selectedSubjects = data.selectedSubjects
            // Save to localStorage for future use
            localStorage.setItem("selectedSubjects", JSON.stringify(selectedSubjects))
          }
        }
      }

      // If we have selected subjects, check the corresponding checkboxes
      if (selectedSubjects.length > 0) {
        // Uncheck all first
        document.querySelectorAll('input[name="industry"]').forEach((cb) => {
          cb.checked = false
        })

        // Check each selected subject
        selectedSubjects.forEach((subjectValue) => {
          const checkbox = Array.from(document.querySelectorAll('input[name="industry"]')).find(
            (cb) => cb.value === subjectValue,
          )

          if (checkbox) {
            checkbox.checked = true

            // Trigger the change event to show the appropriate skills section
            const event = new Event("change")
            checkbox.dispatchEvent(event)

            // Also ensure skills section is visible
            const subject = checkbox.dataset.industry
            if (subject) {
              const skillsSection = document.getElementById(`${subject}-skills`)
              if (skillsSection) {
                skillsSection.classList.add("visible")
              }
            }
          }
        })
      }
    } catch (error) {
      console.error("Error loading selected subjects:", error)
    }
  }

  // Function to load user services
  async function loadUserServices(userId) {
    try {
      const response = await fetch(`/services/${userId}`)

      if (!response.ok) {
        throw new Error("Не вдалося завантажити послуги")
      }

      const data = await response.json()

      if (data.services && data.services.length > 0) {
        // Uncheck all checkboxes first
        document.querySelectorAll('#services input[type="checkbox"]').forEach((checkbox) => {
          checkbox.checked = false
        })

        // Clear all textareas
        document.querySelectorAll("#services textarea").forEach((textarea) => {
          textarea.value = ""
        })

        const selectedSubjects = []
        const selectedSubjectValues = []

        // Process all services
        data.services.forEach((service) => {
          if (service.service_type === "industry") {
            const checkbox = Array.from(document.querySelectorAll('input[name="industry"]')).find(
              (cb) => cb.value === service.service_name,
            )

            if (checkbox) {
              checkbox.checked = true
              selectedSubjectValues.push(service.service_name)
              if (checkbox.dataset.industry) {
                selectedSubjects.push(checkbox.dataset.industry)
              }
            }
          } else if (service.service_type.endsWith("-skills-text")) {
            const textarea = document.getElementById(service.service_type)
            if (textarea) {
              textarea.value = service.service_name
            }
          } else if (service.service_type === "custom-skills") {
            const customSkills = document.getElementById("custom-skills")
            if (customSkills) {
              customSkills.value = service.service_name
            }
          }
        })

        // Save selected subjects to localStorage
        localStorage.setItem("selectedSubjects", JSON.stringify(selectedSubjectValues))

        // Show subject-specific skills sections
        selectedSubjects.forEach((subject) => {
          const skillsSection = document.getElementById(`${subject}-skills`)
          if (skillsSection) {
            skillsSection.classList.add("visible")
            // Add random animation class for initial load
            const animations = ["slide-in-right", "slide-in-left", "slide-in-top", "slide-in-bottom"]
            const randomAnimation = animations[Math.floor(Math.random() * animations.length)]
            skillsSection.classList.add(randomAnimation)
          }
        })
      }
    } catch (error) {
      showError(error.message)
    }
  }

  // Function to load user orders
  async function loadUserOrders() {
    const userId = getUserId()
    if (!userId) return

    const ordersContainer = document.getElementById("orders-container")
    const loadingElement = document.getElementById("orders-loading")

    if (!ordersContainer || !loadingElement) return

    ordersContainer.innerHTML = ""
    loadingElement.style.display = "flex"

    try {
      const response = await fetch(`/orders/user/${userId}`)

      if (!response.ok) {
        throw new Error("Не вдалося завантажити заняття")
      }

      const data = await response.json()

      loadingElement.style.display = "none"

      if (data.orders && data.orders.length > 0) {
        // Update orders count
        const ordersCount = document.getElementById("orders-count")
        if (ordersCount) {
          ordersCount.textContent = data.orders.length
        }

        data.orders.forEach((order, index) => {
          // Add animation delay based on index
          const delay = index * 0.1

          const orderCard = document.createElement("div")
          orderCard.className = "order-card"
          orderCard.style.animationDelay = `${delay}s`

          const statusClass = `status-${order.status}`
          const statusText = getOrderStatusText(order.status)

          orderCard.innerHTML = `
            <div class="order-header">
              <div class="order-number">${order.id}</div>
              <div class="order-title">${order.title}</div>
              <div class="order-status ${statusClass}">${statusText}</div>
            </div>
            <div class="order-body">
              <div class="order-info">
                <div class="order-info-item">
                  <div class="order-info-label">Предмет:</div>
                  <div class="order-info-value">${order.industry || "Не вказано"}</div>
                </div>
                <div class="order-info-item">
                  <div class="order-info-label">Дата створення:</div>
                  <div class="order-info-value">${formatDate(order.created_at)}</div>
                </div>
                <div class="order-info-item">
                  <div class="order-info-label">Телефон:</div>
                  <div class="order-info-value">${order.phone || "Не вказано"}</div>
                </div>
              </div>
              <div class="order-actions">
                <button onclick="viewOrderDetails(${order.id})"><i class="fas fa-eye"></i> Деталі</button>
                ${
                  order.status === "completed"
                    ? `<button onclick="leaveReview(${order.id}, ${order.master_id})"><i class="fas fa-star"></i> Відгук</button>`
                    : ""
                }
                ${
                  order.status === "pending"
                    ? `<button onclick="cancelOrder(${order.id})"><i class="fas fa-times"></i> Скасувати</button>`
                    : ""
                }
              </div>
            </div>
          `

          ordersContainer.appendChild(orderCard)
        })
      } else {
        ordersContainer.innerHTML = '<p style="text-align: center; padding: 30px;">У вас ще немає занять</p>'
      }
    } catch (error) {
      loadingElement.style.display = "none"
      ordersContainer.innerHTML = `<p style="text-align: center; padding: 30px; color: var(--danger-color);">Помилка: ${error.message}</p>`
    }
  }

  // Function to load user reviews
  async function loadUserReviews() {
    const userId = getUserId()
    if (!userId) return

    const reviewsContainer = document.getElementById("reviews-container")
    const loadingElement = document.getElementById("reviews-loading")

    if (!reviewsContainer || !loadingElement) return

    reviewsContainer.innerHTML = ""
    loadingElement.style.display = "flex"

    try {
      const response = await fetch(`/reviews/master/${userId}`)

      if (!response.ok) {
        throw new Error("Не вдалося завантажити відгуки")
      }

      const data = await response.json()

      loadingElement.style.display = "none"

      if (data.reviews && data.reviews.length > 0) {
        data.reviews.forEach((review, index) => {
          // Add animation delay based on index
          const delay = index * 0.1

          const reviewCard = document.createElement("div")
          reviewCard.className = "review-card"
          reviewCard.style.animationDelay = `${delay}s`

          const reviewerName =
            review.user_first_name && review.user_last_name ?
            `${review.user_first_name} ${review.user_last_name}` :
            review.user_username

          const reviewerInitials =
            review.user_first_name && review.user_last_name ?
            `${review.user_first_name.charAt(0)}${review.user_last_name.charAt(0)}` :
            review.user_username ?
            review.user_username.charAt(0).toUpperCase() :
            "A"

          reviewCard.innerHTML = `
            <div class="review-header">
              <div class="reviewer-info">
                <div class="reviewer-avatar">${reviewerInitials}</div>
                <div>
                  <div class="reviewer-name">${reviewerName || "Анонімний користувач"}</div>
                  <div class="review-date">${formatDate(review.created_at)}</div>
                </div>
              </div>
              <div class="review-rating">
                ${generateStarRating(review.rating)}
              </div>
            </div>
            <div class="review-content">
              ${review.comment || review.text || "Без коментаря"}
            </div>
            <div class="review-order">
              Заняття: ${review.order_title || "Заняття"} (${review.order_id || review.id})
            </div>
          `

          reviewsContainer.appendChild(reviewCard)
        })
      } else {
        reviewsContainer.innerHTML = '<p style="text-align: center; padding: 30px;">У вас ще немає відгуків</p>'
      }
    } catch (error) {
      loadingElement.style.display = "none"
      reviewsContainer.innerHTML = `<p style="text-align: center; padding: 30px; color: var(--danger-color);">Помилка: ${error.message}</p>`
    }
  }

  // Helper function to generate star rating
  function generateStarRating(rating) {
    let stars = ""
    for (let i = 1; i <= 5; i++) {
      if (i <= rating) {
        stars += '<i class="fas fa-star"></i>'
      } else if (i - 0.5 <= rating) {
        stars += '<i class="fas fa-star-half-alt"></i>'
      } else {
        stars += '<i class="far fa-star"></i>'
      }
    }
    return stars
  }

  // Helper function to format date
  function formatDate(dateString) {
    const date = new Date(dateString)
    return date.toLocaleDateString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // Helper function to get order status text
  function getOrderStatusText(status) {
    switch (status) {
      case "pending":
        return "Очікує"
      case "approved":
        return "Прийнято"
      case "completed":
        return "Виконано"
      case "cancelled":
        return "Скасовано"
      case "rejected":
        return "Відхилено"
      default:
        return status
    }
  }

  // Function to show error message
  function showError(message) {
    const errorElement = document.getElementById("error-message")
    if (!errorElement) {
      // Create error element if it doesn't exist
      const errorDiv = document.createElement("div")
      errorDiv.id = "error-message"
      errorDiv.className = "message error-message"
      errorDiv.style.display = "none"
      document.body.appendChild(errorDiv)
    }

    errorElement.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`
    errorElement.style.display = "flex"

    setTimeout(() => {
      errorElement.style.animation = "fadeInScale 0.4s ease-out reverse"
      setTimeout(() => {
        errorElement.style.display = "none"
        errorElement.style.animation = ""
      }, 400)
    }, 5000)
  }

  // Function to show success message
  function showSuccess(message) {
    const successElement = document.getElementById("success-message")
    if (!successElement) {
      // Create success element if it doesn't exist
      const successDiv = document.createElement("div")
      successDiv.id = "success-message"
      successDiv.className = "message success-message"
      successDiv.style.display = "none"
      document.body.appendChild(successDiv)
    }

    successElement.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`
    successElement.style.display = "flex"

    setTimeout(() => {
      successElement.style.animation = "fadeInScale 0.4s ease-out reverse"
      setTimeout(() => {
        successElement.style.display = "none"
        successElement.style.animation = ""
      }, 400)
    }, 5000)
  }

  // Function to show info message
  function showInfo(message) {
    const infoElement = document.getElementById("info-message")
    if (!infoElement) {
      // Create info element if it doesn't exist
      const infoDiv = document.createElement("div")
      infoDiv.id = "info-message"
      infoDiv.className = "message info-message"
      infoDiv.style.display = "none"
      document.body.appendChild(infoDiv)
    }

    infoElement.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`
    infoElement.style.display = "flex"

    setTimeout(() => {
      infoElement.style.animation = "fadeInScale 0.4s ease-out reverse"
      setTimeout(() => {
        infoElement.style.display = "none"
        infoElement.style.animation = ""
      }, 400)
    }, 5000)
  }

  // Add animation for services toggle
  const roleMasterCheckbox = document.getElementById("role_master")
  if (roleMasterCheckbox) {
    roleMasterCheckbox.addEventListener("change", function () {
      toggleServicesSection(this.checked)
    })
  }

  // Enhanced transitions for subject checkboxes
  let lastActiveSubject = null

  document.querySelectorAll('input[name="industry"]').forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const subject = this.dataset.industry
      if (!subject) return

      const skillsSection = document.getElementById(`${subject}-skills`)
      if (!skillsSection) return

      if (this.checked) {
        // Save all selected subjects
        const selectedSubjects = saveSelectedSubjects()
        console.log("Saved subjects:", selectedSubjects)

        // Determine animation direction based on position in the list
        const allSubjects = Array.from(document.querySelectorAll('input[name="industry"]'))
        const currentIndex = allSubjects.indexOf(this)

        // Remove all animation classes first
        skillsSection.classList.remove("slide-in-right", "slide-in-left", "slide-in-top", "slide-in-bottom")

        // Add appropriate animation class
        if (lastActiveSubject) {
          const lastIndex = allSubjects.findIndex((cb) => cb.dataset.industry === lastActiveSubject)

          if (currentIndex > lastIndex) {
            skillsSection.classList.add("slide-in-right")
          } else {
            skillsSection.classList.add("slide-in-left")
          }
        } else {
          skillsSection.classList.add("slide-in-bottom")
        }

        // Show the section with animation
        skillsSection.classList.add("visible")
        lastActiveSubject = subject
      } else {
        // Add fade out animation
        skillsSection.classList.add("fade-out")

        // Remove the section after animation completes
        setTimeout(() => {
          skillsSection.classList.remove("visible")
          skillsSection.classList.remove("fade-out")
          skillsSection.classList.remove("slide-in-right", "slide-in-left", "slide-in-top", "slide-in-bottom")

          // Save all selected subjects after unchecking
          saveSelectedSubjects()

          // Update last active subject
          const activeCheckboxes = Array.from(document.querySelectorAll('input[name="industry"]:checked'))
          if (activeCheckboxes.length > 0) {
            lastActiveSubject = activeCheckboxes[activeCheckboxes.length - 1].dataset.industry
          } else {
            lastActiveSubject = null
          }
        }, 400)
      }
    })
  })

  // Password strength checker
  const newPasswordInput = document.getElementById("new-password")
  if (newPasswordInput) {
    newPasswordInput.addEventListener("input", function () {
      const password = this.value
      const strengthBar = document.getElementById("password-strength")
      if (!strengthBar) return

      // Check requirements
      const hasLength = password.length >= 8
      const hasUppercase = /[A-Z]/.test(password)
      const hasLowercase = /[a-z]/.test(password)
      const hasNumber = /[0-9]/.test(password)
      const hasSpecial = /[^A-Za-z0-9]/.test(password)

      // Update requirement indicators
      updateRequirement("req-length", hasLength)
      updateRequirement("req-uppercase", hasUppercase)
      updateRequirement("req-lowercase", hasLowercase)
      updateRequirement("req-number", hasNumber)
      updateRequirement("req-special", hasSpecial)

      // Calculate strength
      let strength = 0
      if (hasLength) strength += 1
      if (hasUppercase) strength += 1
      if (hasLowercase) strength += 1
      if (hasNumber) strength += 1
      if (hasSpecial) strength += 1

      // Update strength bar
      strengthBar.className = "password-strength"
      if (strength < 3) {
        strengthBar.classList.add("password-strength-weak")
      } else if (strength < 5) {
        strengthBar.classList.add("password-strength-medium")
      } else {
        strengthBar.classList.add("password-strength-strong")
      }
    })
  }

  // Helper function to update requirement indicator
  function updateRequirement(id, isMet) {
    const element = document.getElementById(id)
    if (!element) return

    if (isMet) {
      element.classList.add("requirement-met")
      element.classList.remove("requirement-unmet")
      const icon = element.querySelector("i")
      if (icon) {
        icon.className = "fas fa-check-circle"
      }
    } else {
      element.classList.add("requirement-unmet")
      element.classList.remove("requirement-met")
      const icon = element.querySelector("i")
      if (icon) {
        icon.className = "fas fa-times-circle"
      }
    }
  }

  // Password change form handler
  const passwordForm = document.getElementById("password-form")
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault()

      const currentPassword = document.getElementById("current-password").value
      const newPassword = document.getElementById("new-password").value
      const confirmPassword = document.getElementById("confirm-password").value

      if (newPassword !== confirmPassword) {
        showError("Паролі не співпадають")
        return
      }

      // Check password strength
      const hasLength = newPassword.length >= 8
      const hasUppercase = /[A-Z]/.test(newPassword)
      const hasLowercase = /[a-z]/.test(newPassword)
      const hasNumber = /[0-9]/.test(newPassword)
      const hasSpecial = /[^A-Za-z0-9]/.test(newPassword)

      if (!(hasLength && hasUppercase && hasLowercase && hasNumber && hasSpecial)) {
        showError("Пароль не відповідає вимогам безпеки")
        return
      }

      try {
        const userId = getUserId()
        if (!userId) return

        // Show loading state
        const submitButton = passwordForm.querySelector('button[type="submit"]')
        const originalText = submitButton.innerHTML
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Зачекайте...'
        submitButton.disabled = true

        const response = await fetch(`/change-password/${userId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            currentPassword,
            newPassword,
          }),
        })

        // Reset button state
        submitButton.innerHTML = originalText
        submitButton.disabled = false

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || "Не вдалося змінити пароль")
        }

        showSuccess("Пароль успішно змінено!")

        // Clear form
        document.getElementById("current-password").value = ""
        document.getElementById("new-password").value = ""
        document.getElementById("confirm-password").value = ""

        // Reset strength bar
        const strengthBar = document.getElementById("password-strength")
        if (strengthBar) {
          strengthBar.className = "password-strength"
        }

        // Reset requirements
        document.querySelectorAll(".requirement").forEach((req) => {
          req.classList.remove("requirement-met", "requirement-unmet")
          const icon = req.querySelector("i")
          if (icon) {
            icon.className = "fas fa-circle"
          }
        })
      } catch (error) {
        showError(error.message)
      }
    })
  }

  // Save settings handler
  const saveSettingsBtn = document.getElementById("save-settings")
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      const userId = getUserId()
      if (!userId) return

      const emailNotifications = document.getElementById("email-notifications")
      const orderNotifications = document.getElementById("order-notifications")
      const reviewNotifications = document.getElementById("review-notifications")

      const settings = {
        email_notifications: emailNotifications ? emailNotifications.checked : false,
        order_notifications: orderNotifications ? orderNotifications.checked : false,
        review_notifications: reviewNotifications ? reviewNotifications.checked : false,
      }

      try {
        // Show loading state
        const originalText = saveSettingsBtn.innerHTML
        saveSettingsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Зачекайте...'
        saveSettingsBtn.disabled = true

        const response = await fetch(`/user-settings/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify(settings),
        })

        // Reset button state
        saveSettingsBtn.innerHTML = originalText
        saveSettingsBtn.disabled = false

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || "Не вдалося зберегти налаштування")
        }

        showSuccess("Налаштування успішно збережено!")
      } catch (error) {
        showError(error.message)
      }
    })
  }

  // Avatar upload functionality
  const avatarUploadBtn = document.getElementById("avatar-upload")
  if (avatarUploadBtn) {
    avatarUploadBtn.addEventListener("click", () => {
      document.getElementById("avatar-input").click()
    })
  }

  const avatarInput = document.getElementById("avatar-input")
  if (avatarInput) {
    avatarInput.addEventListener("change", async (event) => {
      const file = event.target.files[0]
      if (!file) return

      // Check file type
      if (!file.type.startsWith("image/")) {
        showError("Будь ласка, виберіть зображення")
        return
      }

      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        showError("Розмір файлу не повинен перевищувати 5MB")
        return
      }

      const userId = getUserId()
      if (!userId) {
        showError("Необхідно авторизуватися")
        return
      }

      const token = localStorage.getItem("token")
      if (!token) {
        showError("Токен авторизації відсутній. Будь ласка, увійдіть знову")
        setTimeout(() => {
          window.location.href = "/auth.html"
        }, 2000)
        return
      }

      // Show loading state
      const avatarContainer = document.querySelector(".profile-avatar")
      if (avatarContainer) {
        avatarContainer.classList.add("uploading")
      }

      // Create FormData
      const formData = new FormData()
      formData.append("avatar", file)

      try {
        // Upload avatar
        const response = await fetch(`/upload-avatar/${userId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        })

        if (response.status === 401 || response.status === 403) {
          // Token is invalid or expired
          localStorage.removeItem("token")
          localStorage.removeItem("userId")
          showError("Сесія прострочена. Будь ласка, увійдіть знову")
          setTimeout(() => {
            window.location.href = "/auth.html"
          }, 2000)
          return
        }

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || "Не вдалося завантажити аватар")
        }

        const data = await response.json()

        if (data.imageUrl) {
          // Add cache busting parameter
          const imageUrl = `${data.imageUrl}?t=${Date.now()}`

          // Preload image before displaying
          const img = new Image()
          img.onload = () => {
            const avatarImage = document.getElementById("avatar-image")
            if (avatarImage) {
              avatarImage.src = imageUrl
              avatarImage.style.display = "block"

              const avatarInitials = document.getElementById("avatar-initials")
              if (avatarInitials) {
                avatarInitials.style.display = "none"
              }
            }

            showSuccess("Аватар успішно оновлено!")
          }

          img.onerror = () => {
            showError("Помилка завантаження зображення")
          }

          img.src = imageUrl
        } else {
          throw new Error("Сервер не повернув URL зображення")
        }
      } catch (error) {
        console.error("[v0] Avatar upload error:", error)
        showError(error.message)
      } finally {
        const avatarContainer = document.querySelector(".profile-avatar")
        if (avatarContainer) {
          avatarContainer.classList.remove("uploading")
        }

        // Clear input
        event.target.value = ""
      }
    })
  }

  // Order action functions
  window.viewOrderDetails = (orderId) => {
    window.location.href = `/order-details.html?id=${orderId}`
  }

  window.leaveReview = (orderId, masterId) => {
    window.location.href = `/leave-review.html?orderId=${orderId}&masterId=${masterId}`
  }

  window.cancelOrder = async (orderId) => {
    if (!confirm("Ви впевнені, що хочете скасувати це заняття?")) {
      return
    }

    try {
      const response = await fetch(`/orders/${orderId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          status: "cancelled"
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Не вдалося скасувати заняття")
      }

      showSuccess("Заняття успішно скасовано!")

      // Reload orders
      setTimeout(() => {
        loadUserOrders()
      }, 1000)
    } catch (error) {
      showError(error.message)
    }
  }

  // Logout handler
  const logoutBtn = document.getElementById("logout")
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (event) => {
      event.preventDefault()
      localStorage.removeItem("userId")
      localStorage.removeItem("token")
      window.location.href = "/auth.html"
    })
  }

  // Save profile handler
  window.saveProfile = async (event) => {
    event.preventDefault()

    // Get all selected subjects
    const selectedSubjects = getSelectedSubjects()

    // Save to localStorage
    localStorage.setItem("selectedSubjects", JSON.stringify(selectedSubjects))

    const userId = localStorage.getItem("userId")
    const token = localStorage.getItem("token")

    if (!userId || !token) {
      showError("Необхідно авторизуватися для збереження профілю")
      return
    }

    // Show loading state
    const submitButton = event.target.querySelector('button[type="submit"]')
    const originalButtonText = submitButton ? submitButton.innerHTML : "Зберегти"
    if (submitButton) {
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Зачекайте...'
      submitButton.disabled = true
    }

    try {
      // Get form data
      const formData = {
        first_name: document.getElementById("first_name").value,
        last_name: document.getElementById("last_name").value,
        email: document.getElementById("email").value,
        phone: document.getElementById("phone").value,
        address: document.getElementById("address").value,
        date_of_birth: document.getElementById("date_of_birth").value,
        role_master: document.getElementById("role_master").checked,
      }

      // Update user profile
      const profileResponse = await fetch(`/profile/${userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })

      if (!profileResponse.ok) {
        throw new Error("Помилка при оновленні профілю")
      }

      const profileData = await profileResponse.json()

      // If user is a tutor, save selected subjects and services
      if (formData.role_master) {
        // Get all selected subject checkboxes
        const selectedSubjectCheckboxes = Array.from(document.querySelectorAll('input[name="industry"]:checked'))

        if (selectedSubjectCheckboxes.length === 0) {
          throw new Error("Будь ласка, виберіть хоча б один предмет")
        }

        // First, get existing services to identify which ones to delete
        const existingServicesResponse = await fetch(`/services/${userId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        if (!existingServicesResponse.ok) {
          throw new Error("Помилка при отриманні послуг")
        }

        const existingServicesData = await existingServicesResponse.json()

        // Delete all existing services (both subjects and specific services)
        for (const service of existingServicesData.services) {
          await fetch(`/services/${service.id}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })
        }

        // Add all the selected subjects
        for (const checkbox of selectedSubjectCheckboxes) {
          await fetch(`/services/${userId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              service_name: checkbox.value,
              service_type: "industry",
            }),
          })

          // Now handle services for this subject
          const subjectId = checkbox.dataset.industry
          const serviceCheckboxes = document.querySelectorAll(`input[name="service-${subjectId}"]:checked`)

          // Add selected services for this subject
          for (const serviceCheckbox of serviceCheckboxes) {
            await fetch(`/services/${userId}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                service_name: serviceCheckbox.value,
                service_type: "service",
              }),
            })
          }

          // Add skills text for this subject if it exists
          const skillsTextarea = document.getElementById(`${subjectId}-skills-text`)
          if (skillsTextarea && skillsTextarea.value.trim()) {
            await fetch(`/services/${userId}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                service_name: skillsTextarea.value.trim(),
                service_type: `${subjectId}-skills-text`,
              }),
            })
          }
        }

        // Add custom skills if they exist
        const customSkills = document.getElementById("custom-skills")
        if (customSkills && customSkills.value.trim()) {
          await fetch(`/services/${userId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              service_name: customSkills.value.trim(),
              service_type: "custom-skills",
            }),
          })
        }

        // Save all selected subjects to the server
        await fetch(`/api/user-selected-subjects/${userId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            selectedSubjects: selectedSubjects,
          }),
        })
      }

      // Show success message
      showSuccess("Профіль успішно оновлено")

      // If profile requires approval, show message
      if (profileData.requiresApproval) {
        showInfo("Ваш запит на роль репетитора відправлено на розгляд адміністратору")
      }

      // Reload the page without clearing the form
      setTimeout(() => {
        // Reload profile data instead of refreshing the page
        loadUserProfile()
      }, 1000)
    } catch (error) {
      console.error("Error saving profile:", error)
      showError("Помилка при збереженні профілю: " + error.message)
    } finally {
      // Reset button state
      if (submitButton) {
        submitButton.innerHTML = originalButtonText
        submitButton.disabled = false
      }
    }
  }

  // Load profile on page load
  loadUserProfile()

  // Check if we need to show a specific tab based on URL parameter
  const urlParams = new URLSearchParams(window.location.search)
  const tab = urlParams.get("tab")

  if (tab) {
    const tabElement = document.querySelector(`.tab[data-tab="${tab}"]`)
    if (tabElement) {
      tabElement.click()
    }
  }
})

// Function to check if user is logged in
function checkUserLoggedIn() {
  // Replace with actual implementation
  return localStorage.getItem("token") !== null
}

// Function to redirect to auth page
function redirectToAuth() {
  // Replace with actual implementation
  window.location.href = "auth.html"
}

// Function to log out user
function logoutUser() {
  // Replace with actual implementation
  localStorage.removeItem("token")
  localStorage.removeItem("userId")
  window.location.href = "index.html"
}

// Update UI based on login status
function updateUIForLoginStatus() {
  const isLoggedIn = checkUserLoggedIn()
  const orderSection = document.getElementById("order")
  const orderLink = document.getElementById("orderLink")
  const profileLink = document.getElementById("profileLink")
  const profileFooterLink = document.getElementById("profileFooterLink")
  const loginBtn = document.getElementById("loginBtn")
  const loginModal = document.getElementById("loginModal")
  const reviewSection = document.getElementById("review-form")

  if (isLoggedIn) {
    // User is logged in
    if (orderSection) orderSection.style.display = "block"
    if (orderLink) orderLink.style.display = "block"
    if (profileLink) profileLink.style.display = "block"
    if (profileFooterLink) profileFooterLink.style.display = "block"
    if (reviewSection) reviewSection.style.display = "block"
    if (loginBtn) {
      loginBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Вийти'
      loginBtn.removeEventListener("click", redirectToAuth)
      loginBtn.addEventListener("click", logoutUser)
    }

    // Check user role and update UI accordingly
    const userId = localStorage.getItem("userId")
    if (userId && window.RoleSystem) {
      window.RoleSystem.checkUserRole(userId)
    } else {
      // If RoleSystem is not available, hide tutor elements by default
      const infoLink = document.getElementById("info")
      if (infoLink) infoLink.style.display = "none"
    }
  } else {
    // User is not logged in
    if (orderSection) orderSection.style.display = "none"
    if (orderLink) orderLink.style.display = "none"
    if (profileLink) profileLink.style.display = "none"
    if (profileFooterLink) profileFooterLink.style.display = "none"
    if (reviewSection) reviewSection.style.display = "none"
    if (loginBtn) {
      loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Увійти'
      loginBtn.removeEventListener("click", logoutUser)
      loginBtn.addEventListener("click", redirectToAuth)
    }

    // Show login modal for new users
    if (loginModal && !localStorage.getItem("modalShown")) {
      setTimeout(() => {
        loginModal.classList.add("active")
        localStorage.setItem("modalShown", "true")
      }, 1500)
    }

    // Hide tutor elements for non-logged in users
    const infoLink = document.getElementById("info")
    if (infoLink) infoLink.style.display = "none"
  }
}

// Call updateUIForLoginStatus when the page loads
document.addEventListener("DOMContentLoaded", updateUIForLoginStatus)