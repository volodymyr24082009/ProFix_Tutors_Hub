/* global io */

// Global variables
let allOrders = []
let currentFilter = "all"
let currentSubjectFilter = "all"
let userRole = null
let userId = null
let socket = null

// Pagination variables
let currentPage = 1
const itemsPerPage = 9
let totalPages = 1

// DOM Elements
const ordersContainer = document.getElementById("ordersContainer")
const noOrdersMessage = document.getElementById("noOrdersMessage")
const filterButtons = document.querySelectorAll(".filter-btn")
const subjectFilter = document.getElementById("industryFilter") // Keep the ID for compatibility
const orderDetailsModal = document.getElementById("orderDetailsModal")
const orderModalClose = document.getElementById("orderModalClose")
const orderModalContent = document.getElementById("orderModalContent")
const orderModalActions = document.getElementById("orderModalActions")
const confirmationModal = document.getElementById("confirmationModal")
const confirmationModalClose = document.getElementById("confirmationModalClose")
const confirmBtn = document.getElementById("confirmBtn")
const cancelBtn = document.getElementById("cancelBtn")
const confirmationMessage = document.getElementById("confirmationMessage")
const prevPageBtn = document.getElementById("prevPageBtn")
const nextPageBtn = document.getElementById("nextPageBtn")
const currentPageSpan = document.getElementById("currentPage")
const totalPagesSpan = document.getElementById("totalPages")

// Initialize the page
document.addEventListener("DOMContentLoaded", () => {
  // Check user authentication
  checkUserLoggedIn()

  // Set up event listeners
  setupEventListeners()

  // Initialize Socket.io connection
  initializeSocket()

  // Load orders
  fetchOrders()
})

// Initialize Socket.io connection
function initializeSocket() {
  try {
    socket = window.io() // Declare the variable before using it

    // Listen for new orders
    socket.on("new-order", (order) => {
      console.log("New order received:", order)

      // Add the new order to our list if it's not already there
      if (!allOrders.some((o) => o.id === order.id)) {
        allOrders.unshift(order)
        showNotification("Отримано нову заявку на заняття", "info")
        filterAndRenderOrders()
      }
    })

    // Listen for order updates
    socket.on("order-updated", (updatedOrder) => {
      console.log("Order updated:", updatedOrder)

      // Update the order in our list
      const index = allOrders.findIndex((o) => o.id === updatedOrder.id)
      if (index !== -1) {
        allOrders[index] = updatedOrder
        showNotification(`Заявку #${updatedOrder.id} оновлено`, "info")
        filterAndRenderOrders()
      }
    })

    // Listen for order deletions
    socket.on("order-deleted", (orderId) => {
      console.log("Order deleted:", orderId)

      // Remove the order from our list
      allOrders = allOrders.filter((o) => o.id !== orderId)
      showNotification(`Заявку #${orderId} видалено`, "info")
      filterAndRenderOrders()
    })

    console.log("Socket.io connection established")
  } catch (error) {
    console.error("Failed to initialize Socket.io:", error)
    showNotification("Не вдалося встановити з'єднання для оновлень в реальному часі", "error")
  }
}

// Check if user is logged in and get role
function checkUserLoggedIn() {
  userId = localStorage.getItem("userId")

  if (!userId) {
    // Redirect to login page if not logged in
    window.location.href = "auth.html"
    return false
  }

  // Fetch user profile to determine role
  fetch(`/profile/${userId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to fetch user profile")
      }
      return response.json()
    })
    .then((data) => {
      if (data.profile) {
        userRole = data.profile.role_master ? "tutor" : "user"

        // Check if user is admin (for demo purposes, user with ID 1 is admin)
        if (userId === "1") {
          userRole = "admin"
        }

        // Update UI based on user role
        updateUIForRole()

        // Join the appropriate room for real-time updates
        if (socket) {
          socket.emit("join-room", {
            userId,
            userRole
          })
        }
      }
    })
    .catch((error) => {
      console.error("Error fetching user profile:", error)
      showNotification("Помилка при отриманні профілю користувача", "error")
    })

  return true
}

// Update UI elements based on user role
function updateUIForRole() {
  // Show/hide elements based on role
  if (userRole === "admin") {
    // Admin can see all orders
    fetchOrders("/orders")
  } else if (userRole === "tutor") {
    // Tutors can see pending orders and their own orders
    fetchOrders(`/orders/tutor/${userId}`)

    // Also fetch user's selected subject
    fetchTutorSubject()
  } else {
    // Regular users can only see their own orders
    fetchOrders(`/orders/user/${userId}`)
  }
}

// Fetch tutor's selected subject
function fetchTutorSubject() {
  fetch(`/api/user-selected-subject/${userId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to fetch tutor subject")
      }
      return response.json()
    })
    .then((data) => {
      if (data.success && data.selectedSubject) {
        // Store the tutor's subject for later use
        localStorage.setItem("tutorSubject", data.selectedSubject)
      }
    })
    .catch((error) => {
      console.error("Error fetching tutor subject:", error)
    })
}

// Set up event listeners
function setupEventListeners() {
  // Filter buttons
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      // Update active filter
      filterButtons.forEach((btn) => btn.classList.remove("active"))
      button.classList.add("active")

      // Apply filter
      currentFilter = button.dataset.status
      currentPage = 1 // Reset to first page when filter changes
      filterAndRenderOrders()
    })
  })

  // Subject filter
  subjectFilter.addEventListener("change", () => {
    currentSubjectFilter = subjectFilter.value
    currentPage = 1 // Reset to first page when filter changes
    filterAndRenderOrders()
  })

  // Modal close button
  orderModalClose.addEventListener("click", () => {
    orderDetailsModal.classList.remove("active")
  })

  // Close modal when clicking outside
  orderDetailsModal.addEventListener("click", (e) => {
    if (e.target === orderDetailsModal) {
      orderDetailsModal.classList.remove("active")
    }
  })

  // Confirmation modal close button
  confirmationModalClose.addEventListener("click", () => {
    confirmationModal.classList.remove("active")
  })

  // Cancel button in confirmation modal
  cancelBtn.addEventListener("click", () => {
    confirmationModal.classList.remove("active")
  })

  // Close confirmation modal when clicking outside
  confirmationModal.addEventListener("click", (e) => {
    if (e.target === confirmationModal) {
      confirmationModal.classList.remove("active")
    }
  })

  // Pagination buttons
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--
      filterAndRenderOrders()
    }
  })

  nextPageBtn.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++
      filterAndRenderOrders()
    }
  })

  // Theme toggle
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

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById("mobileMenuBtn")
  const navMenu = document.getElementById("navMenu")

  mobileMenuBtn.addEventListener("click", function () {
    navMenu.classList.toggle("active")

    // Change icon based on menu state
    const icon = this.querySelector("i")
    if (navMenu.classList.contains("active")) {
      icon.classList.remove("fa-bars")
      icon.classList.add("fa-times")
    } else {
      icon.classList.remove("fa-times")
      icon.classList.add("fa-bars")
    }
  })
}

// Fetch orders from the server
function fetchOrders(endpoint = "/orders") {
  // Show loading spinner
  ordersContainer.innerHTML = `
    <div class="loading-spinner">
      <i class="fas fa-spinner fa-spin"></i>
      <span>Завантаження заявок...</span>
    </div>
  `

  fetch(endpoint)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok")
      }
      return response.json()
    })
    .then((data) => {
      if (data.orders && data.orders.length > 0) {
        allOrders = data.orders
        filterAndRenderOrders()
        noOrdersMessage.style.display = "none"
      } else {
        ordersContainer.innerHTML = ""
        noOrdersMessage.style.display = "flex"
        updatePaginationControls(0, 0)
      }
    })
    .catch((error) => {
      console.error("Error fetching orders:", error)
      ordersContainer.innerHTML = `
        <div class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Помилка при завантаженні заявок. Спробуйте оновити сторінку.</p>
        </div>
      `
      updatePaginationControls(0, 0)
    })
}

// Filter orders based on current filters and render them
function filterAndRenderOrders() {
  let filteredOrders = [...allOrders]

  // Apply status filter
  if (currentFilter !== "all") {
    filteredOrders = filteredOrders.filter((order) => order.status === currentFilter)
  }

  // Apply subject filter
  if (currentSubjectFilter !== "all") {
    filteredOrders = filteredOrders.filter((order) => order.industry === currentSubjectFilter)
  }

  // Calculate pagination
  totalPages = Math.ceil(filteredOrders.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const ordersToRender = filteredOrders.slice(startIndex, endIndex)

  // Update pagination controls
  updatePaginationControls(currentPage, totalPages)

  // Render the orders
  renderOrders(ordersToRender, filteredOrders.length)
}

// Update pagination controls
function updatePaginationControls(page, total) {
  currentPageSpan.textContent = page
  totalPagesSpan.textContent = total

  // Enable/disable pagination buttons
  prevPageBtn.disabled = page <= 1
  nextPageBtn.disabled = page >= total

  // Show/hide pagination controls
  const paginationControls = document.getElementById("paginationControls")
  paginationControls.style.display = total > 0 ? "flex" : "none"
}

// Render orders to the container
function renderOrders(orders, totalCount) {
  if (orders.length === 0) {
    ordersContainer.innerHTML = ""
    noOrdersMessage.style.display = "flex"
    return
  }

  noOrdersMessage.style.display = "none"
  ordersContainer.innerHTML = ""

  orders.forEach((order) => {
    const orderCard = document.createElement("div")
    orderCard.className = `order-card ${order.status}`
    orderCard.dataset.id = order.id

    // Add new order animation if created in the last hour
    const orderDate = new Date(order.created_at)
    const now = new Date()
    const isNew = now - orderDate < 3600000 // 1 hour in milliseconds
    if (isNew) {
      orderCard.classList.add("new-order")
    }

    // Format date
    const formattedDate = new Date(order.created_at).toLocaleDateString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

    // Get status class and text
    const statusClass = getStatusClass(order.status)
    const statusText = getStatusText(order.status)

    // Truncate description
    const shortDescription = order.description ?
      order.description.length > 100 ?
      order.description.substring(0, 100) + "..." :
      order.description :
      "Опис відсутній"

    // Get subject icon
    const subjectIcon = getSubjectIcon(order.industry)

    orderCard.innerHTML = `
      <div class="order-status ${statusClass}">${statusText}</div>
      <h3 class="order-title">${order.title}</h3>
      <div class="order-industry">
        <i class="${subjectIcon}"></i>
        <span>${order.industry || "Предмет не вказаний"}</span>
      </div>
      <p class="order-description">${shortDescription}</p>
      <div class="order-meta">
        <div class="order-date">
          <i class="far fa-calendar-alt"></i>
          <span>${formattedDate}</span>
        </div>
      </div>
      <div class="order-actions">
        <button class="order-btn view-btn" data-id="${order.id}">
          <i class="fas fa-eye"></i>
          Переглянути
        </button>
      </div>
    `

    // Add action buttons for tutors and admins if order is pending
    if ((userRole === "tutor" || userRole === "admin") && order.status === "pending") {
      const actionsDiv = orderCard.querySelector(".order-actions")
      actionsDiv.innerHTML = `
        <button class="order-btn view-btn" data-id="${order.id}">
          <i class="fas fa-eye"></i>
          Переглянути
        </button>
        <button class="order-btn accept-btn" data-id="${order.id}">
          <i class="fas fa-check"></i>
          Прийняти
        </button>
        <button class="order-btn reject-btn" data-id="${order.id}">
          <i class="fas fa-times"></i>
          Відхилити
        </button>
      `
    }

    ordersContainer.appendChild(orderCard)
  })

  // Add event listeners to buttons
  addOrderButtonListeners()
}

// Add event listeners to order buttons
function addOrderButtonListeners() {
  // View buttons
  const viewButtons = document.querySelectorAll(".view-btn")
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const orderId = button.dataset.id
      showOrderDetails(orderId)
    })
  })

  // Accept buttons
  const acceptButtons = document.querySelectorAll(".accept-btn")
  acceptButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const orderId = button.dataset.id

      // Check if tutor's subject matches the order's subject
      if (userRole === "tutor") {
        const order = allOrders.find((o) => o.id == orderId)
        const tutorSubject = localStorage.getItem("tutorSubject")

        if (order && tutorSubject && order.industry !== tutorSubject) {
          // Show subject mismatch modal
          const subjectMismatchModal = document.getElementById("industryMismatchModal")
          const tutorSubjectSpan = document.getElementById("masterIndustry")
          const orderSubjectSpan = document.getElementById("orderIndustry")

          tutorSubjectSpan.textContent = tutorSubject
          orderSubjectSpan.textContent = order.industry

          subjectMismatchModal.classList.add("active")

          // Add event listener to close button
          const subjectModalClose = document.getElementById("industryModalClose")
          const subjectModalCloseBtn = document.getElementById("industryModalCloseBtn")

          subjectModalClose.addEventListener("click", () => {
            subjectMismatchModal.classList.remove("active")
          })

          subjectModalCloseBtn.addEventListener("click", () => {
            subjectMismatchModal.classList.remove("active")
          })

          return
        }
      }

      // Show confirmation modal
      showConfirmationModal("Ви впевнені, що хочете прийняти цю заявку на заняття?", () =>
        updateOrderStatus(orderId, "completed"),
      )
    })
  })

  // Reject buttons
  const rejectButtons = document.querySelectorAll(".reject-btn")
  rejectButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const orderId = button.dataset.id

      // Show confirmation modal
      showConfirmationModal("Ви впевнені, що хочете відхилити цю заявку на заняття?", () =>
        updateOrderStatus(orderId, "rejected"),
      )
    })
  })
}

// Show confirmation modal
function showConfirmationModal(message, confirmCallback) {
  confirmationMessage.textContent = message

  // Set up confirm button
  confirmBtn.onclick = () => {
    confirmCallback()
    confirmationModal.classList.remove("active")
  }

  // Show modal
  confirmationModal.classList.add("active")
}

// Show order details in modal
function showOrderDetails(orderId) {
  const order = allOrders.find((o) => o.id == orderId)

  if (!order) {
    console.error("Order not found:", orderId)
    return
  }

  // Format dates
  const createdDate = new Date(order.created_at).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const updatedDate = new Date(order.updated_at).toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  // Get status class and text
  const statusClass = getStatusClass(order.status)
  const statusText = getStatusText(order.status)

  // Get subject icon
  const subjectIcon = getSubjectIcon(order.industry)

  // Populate modal content
  orderModalContent.innerHTML = `
    <h2 class="modal-title">${order.title}</h2>
    
    <div class="modal-info-group">
      <span class="modal-label">Статус:</span>
      <span class="modal-status ${statusClass}">${statusText}</span>
    </div>
    
    <div class="modal-info-group">
      <span class="modal-label">Предмет:</span>
      <div class="modal-value">
        <i class="${subjectIcon}"></i>
        ${order.industry || "Не вказано"}
      </div>
    </div>
    
    <div class="modal-info-group">
      <span class="modal-label">Опис запиту:</span>
      <div class="modal-value">${order.description || "Опис відсутній"}</div>
    </div>
    
    <div class="modal-info-group">
      <span class="modal-label">Контактний телефон:</span>
      <div class="modal-value">
        <a href="tel:${order.phone}">${order.phone}</a>
      </div>
    </div>
    
    <div class="modal-info-group">
      <span class="modal-label">Учень:</span>
      <div class="modal-value">
        ${order.user_first_name || ""} ${order.user_last_name || ""} 
        ${order.user_first_name || order.user_last_name ? "" : order.user_username || "Невідомо"}
      </div>
    </div>
    
    <div class="modal-info-group">
      <span class="modal-label">Створено:</span>
      <div class="modal-value">${createdDate}</div>
    </div>
    
    <div class="modal-info-group">
      <span class="modal-label">Оновлено:</span>
      <div class="modal-value">${updatedDate}</div>
    </div>
  `

  // Add tutor info if assigned
  if (order.master_id) {
    const tutorName =
      order.master_first_name || order.master_last_name ?
      `${order.master_first_name || ""} ${order.master_last_name || ""}` :
      order.master_username || "Невідомо"

    orderModalContent.innerHTML += `
      <div class="modal-info-group">
        <span class="modal-label">Репетитор:</span>
        <div class="modal-value">${tutorName}</div>
      </div>
    `
  }

  // Set up action buttons based on status and role
  orderModalActions.innerHTML = ""

  if ((userRole === "tutor" || userRole === "admin") && order.status === "pending") {
    orderModalActions.innerHTML = `
      <button class="modal-btn modal-btn-accept" data-id="${order.id}">
        <i class="fas fa-check"></i>
        Прийняти заявку
      </button>
      <button class="modal-btn modal-btn-reject" data-id="${order.id}">
        <i class="fas fa-times"></i>
        Відхилити заявку
      </button>
    `
  } else {
    orderModalActions.innerHTML = `
      <button class="modal-btn modal-btn-close">
        <i class="fas fa-times"></i>
        Закрити
      </button>
    `
  }

  // Add event listeners to modal buttons
  const modalAcceptBtn = orderModalActions.querySelector(".modal-btn-accept")
  if (modalAcceptBtn) {
    modalAcceptBtn.addEventListener("click", () => {
      const orderId = modalAcceptBtn.dataset.id

      // Check if tutor's subject matches the order's subject
      if (userRole === "tutor") {
        const tutorSubject = localStorage.getItem("tutorSubject")

        if (tutorSubject && order.industry !== tutorSubject) {
          // Show subject mismatch modal
          const subjectMismatchModal = document.getElementById("industryMismatchModal")
          const tutorSubjectSpan = document.getElementById("masterIndustry")
          const orderSubjectSpan = document.getElementById("orderIndustry")

          tutorSubjectSpan.textContent = tutorSubject
          orderSubjectSpan.textContent = order.industry

          subjectMismatchModal.classList.add("active")
          orderDetailsModal.classList.remove("active")

          // Add event listener to close button
          const subjectModalClose = document.getElementById("industryModalClose")
          const subjectModalCloseBtn = document.getElementById("industryModalCloseBtn")

          subjectModalClose.addEventListener("click", () => {
            subjectMismatchModal.classList.remove("active")
          })

          subjectModalCloseBtn.addEventListener("click", () => {
            subjectMismatchModal.classList.remove("active")
          })

          return
        }
      }

      // Show confirmation modal
      orderDetailsModal.classList.remove("active")
      showConfirmationModal("Ви впевнені, що хочете прийняти цю заявку на заняття?", () =>
        updateOrderStatus(orderId, "completed"),
      )
    })
  }

  const modalRejectBtn = orderModalActions.querySelector(".modal-btn-reject")
  if (modalRejectBtn) {
    modalRejectBtn.addEventListener("click", () => {
      const orderId = modalRejectBtn.dataset.id

      // Show confirmation modal
      orderDetailsModal.classList.remove("active")
      showConfirmationModal("Ви впевнені, що хочете відхилити цю заявку на заняття?", () =>
        updateOrderStatus(orderId, "rejected"),
      )
    })
  }

  const modalCloseBtn = orderModalActions.querySelector(".modal-btn-close")
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
      orderDetailsModal.classList.remove("active")
    })
  }

  // Show modal
  orderDetailsModal.classList.add("active")
}

// Update order status
function updateOrderStatus(orderId, status) {
  // Show loading state
  const orderCard = document.querySelector(`.order-card[data-id="${orderId}"]`)
  if (orderCard) {
    orderCard.style.opacity = "0.7"
    orderCard.style.pointerEvents = "none"
  }

  // Prepare request data
  const requestData = {
    status: status,
    master_id: userId,
  }

  // Send update request
  fetch(`/orders/${orderId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify(requestData),
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to update order status")
      }
      return response.json()
    })
    .then((data) => {
      if (data.success) {
        // Show success message
        showNotification(`Заявку успішно ${status === "completed" ? "прийнято" : "відхилено"}`, "success")

        // Update local data
        const orderIndex = allOrders.findIndex((o) => o.id == orderId)
        if (orderIndex !== -1) {
          allOrders[orderIndex].status = status
          allOrders[orderIndex].master_id = userId
          allOrders[orderIndex].updated_at = new Date().toISOString()

          // If we have socket connection, emit the update
          if (socket) {
            socket.emit("order-updated", allOrders[orderIndex])
          }
        }

        // Re-render orders
        filterAndRenderOrders()
      } else {
        showNotification("Помилка при оновленні статусу заявки", "error")

        // Reset order card
        if (orderCard) {
          orderCard.style.opacity = "1"
          orderCard.style.pointerEvents = "auto"
        }
      }
    })
    .catch((error) => {
      console.error("Error updating order status:", error)
      showNotification("Помилка з'єднання з сервером", "error")

      // Reset order card
      if (orderCard) {
        orderCard.style.opacity = "1"
        orderCard.style.pointerEvents = "auto"
      }
    })
}

// Helper function to get status class
function getStatusClass(status) {
  switch (status) {
    case "pending":
      return "status-pending"
    case "completed":
      return "status-completed"
    case "rejected":
      return "status-rejected"
    default:
      return ""
  }
}

// Helper function to get status text
function getStatusText(status) {
  switch (status) {
    case "pending":
      return "Очікує розгляду"
    case "completed":
      return "Підтверджено"
    case "rejected":
      return "Відхилено"
    default:
      return "Невідомо"
  }
}

// Helper function to get subject icon
function getSubjectIcon(subject) {
  const subjectIcons = {
    Математика: "fas fa-calculator",
    Фізика: "fas fa-atom",
    Хімія: "fas fa-flask",
    "Українська мова та література": "fas fa-book",
    "Англійська мова": "fas fa-language",
    "Історія України": "fas fa-landmark",
    Біологія: "fas fa-dna",
    Інформатика: "fas fa-laptop-code",
    Географія: "fas fa-globe-americas",
    "Іноземні мови": "fas fa-comments",
  }

  return subjectIcons[subject] || "fas fa-graduation-cap"
}

// Show notification
function showNotification(message, type = "info") {
  // Create notification element if it doesn't exist
  let notification = document.querySelector(".notification")

  if (!notification) {
    notification = document.createElement("div")
    notification.className = "notification"
    document.body.appendChild(notification)
  }

  // Set notification type
  notification.className = `notification ${type}`

  // Set message
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas ${
        type === "success" ? "fa-check-circle" : type === "error" ? "fa-exclamation-circle" : "fa-info-circle"
      }"></i>
      <span>${message}</span>
    </div>
    <button class="notification-close">
      <i class="fas fa-times"></i>
    </button>
  `

  // Show notification
  notification.classList.add("active")

  // Add close button event listener
  const closeBtn = notification.querySelector(".notification-close")
  closeBtn.addEventListener("click", () => {
    notification.classList.remove("active")
  })

  // Auto-hide after 5 seconds
  setTimeout(() => {
    notification.classList.remove("active")
  }, 5000)
}

// Function to check if user is logged in
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

  if (isLoggedIn) {
    // User is logged in
    if (orderSection) orderSection.style.display = "block"
    if (orderLink) orderLink.style.display = "block"
    if (profileLink) profileLink.style.display = "block"
    if (profileFooterLink) profileFooterLink.style.display = "block"
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