
const API_URL = "http://127.0.0.1:8000";

let token = localStorage.getItem("pharmacy_token");
let medicines = [];

// Shortcut for selecting HTML elements
const $ = (id) => document.getElementById(id);

// API request helper
async function apiRequest(url, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (token && url !== "/login" && url !== "/signup") {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}${url}`, {
        ...options,
        headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || "Request failed.");
    }

    return data;
}

// Show Login or Dashboard
function showAuth() {
    $("authScreen").hidden = false;
    $("mainApp").hidden = true;
}

// Switch Login / Signup
$("switchAuth").addEventListener("click", () => {
    const loginVisible = !$("loginForm").hidden;

    $("loginForm").hidden = loginVisible;
    $("signupForm").hidden = !loginVisible;

    $("authSubtitle").textContent = loginVisible
        ? "Create your new account"
        : "Login to your account";

    $("switchText").textContent = loginVisible
        ? "Already have an account?"
        : "Don't have an account?";

    $("switchAuth").textContent = loginVisible
        ? "Login"
        : "Sign up";

    $("authMessage").textContent = "";
});

// Open Dashboard
async function openDashboard(user) {
    $("authScreen").hidden = true;
    $("mainApp").hidden = false;

    $("currentUserName").textContent = user.name;
    $("currentUserEmail").textContent = user.email;

    const firstLetter = user.name.charAt(0).toUpperCase();
    $("profileAvatar").textContent = firstLetter;
    $("topAvatar").textContent = firstLetter;

    showSection("dashboard");

    await loadMedicines();
}

// Login
$("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    $("authMessage").textContent = "Logging in...";

    try {
        const data = await apiRequest("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: $("loginEmail").value.trim(),
                password: $("loginPassword").value
            })
        });

        token = data.access_token;
        localStorage.setItem("pharmacy_token", token);

        $("loginForm").reset();
        $("authMessage").textContent = "";

        await openDashboard(data.user);

    } catch (error) {
        $("authMessage").textContent = error.message;
    }
});

// Signup
$("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    $("authMessage").textContent = "Creating account...";

    try {
        const data = await apiRequest("/signup", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: $("signupName").value.trim(),
                email: $("signupEmail").value.trim(),
                password: $("signupPassword").value
            })
        });

        token = data.access_token;
        localStorage.setItem("pharmacy_token", token);

        $("signupForm").reset();
        $("authMessage").textContent = "";

        await openDashboard(data.user);

    } catch (error) {
        $("authMessage").textContent = error.message;
    }
});

// Logout
function logout() {
    token = null;
    medicines = [];

    localStorage.removeItem("pharmacy_token");

    $("mainApp").hidden = true;
    $("authScreen").hidden = false;

    $("loginForm").reset();
    $("signupForm").reset();

    $("medicineTable").replaceChildren();
    $("authMessage").textContent = "You have logged out.";
}

$("logoutBtn").addEventListener("click", logout);

// Navigation
function showSection(sectionId) {
    document.querySelectorAll(".page-section").forEach((section) => {
        section.classList.toggle(
            "active",
            section.id === sectionId
        );
    });

    document.querySelectorAll(".nav-link").forEach((link) => {
        link.classList.toggle(
            "active",
            link.getAttribute("href") === `#${sectionId}`
        );
    });

    const titles = {
        dashboard: "Dashboard",
        inventory: "Medicine Inventory",
        prescriptions: "Prescriptions",
        alerts: "Stock & Expiry Alerts"
    };

    $("pageTitle").textContent = titles[sectionId] || "Dashboard";
}

document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();

        const sectionId = link.getAttribute("href").substring(1);
        showSection(sectionId);
    });
});

// Medicine status
function getMedicineStatus(medicine) {
    if (medicine.quantity <= 10) {
        return {
            label: "Low Stock",
            className: "low-stock"
        };
    }

    return {
        label: "In Stock",
        className: "in-stock"
    };
}

// Load medicines from backend
async function loadMedicines() {
    try {
        const data = await apiRequest("/medicines");

        medicines = data.map((medicine) => ({
            id: medicine.id,
            name: medicine.name,
            batch: medicine.batch || `MED-${medicine.id}`,
            quantity: medicine.quantity,
            price: Number(medicine.price),
            expiry: medicine.expiry_date || ""
        }));

        renderMedicines();
        updateAlerts();

        $("formMessage").textContent = "";

    } catch (error) {
        $("formMessage").textContent = error.message;
        console.error(error);
    }
}

// Render medicine table
function renderMedicines() {
    const query = $("searchMedicine").value.trim().toLowerCase();

    const filtered = medicines.filter((medicine) =>
        medicine.name.toLowerCase().includes(query) ||
        medicine.batch.toLowerCase().includes(query)
    );

    const table = $("medicineTable");
    table.replaceChildren();

    if (filtered.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 7;
        cell.textContent = "No matching medicines found.";

        row.appendChild(cell);
        table.appendChild(row);
    }

    filtered.forEach((medicine) => {
        const row = document.createElement("tr");
        const status = getMedicineStatus(medicine);

        const values = [
            medicine.name,
            medicine.batch,
            String(medicine.quantity),
            `₹${medicine.price.toFixed(2)}`,
            medicine.expiry || "—"
        ];

        values.forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });

        const statusCell = document.createElement("td");
        const badge = document.createElement("span");

        badge.className = `badge ${status.className}`;
        badge.textContent = status.label;

        statusCell.appendChild(badge);
        row.appendChild(statusCell);

        const actionCell = document.createElement("td");
        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "secondary-btn";
        deleteButton.textContent = "Delete";

        deleteButton.addEventListener("click", async () => {
            if (!confirm(`Delete ${medicine.name}?`)) return;

            try {
                await apiRequest(`/medicines/${medicine.id}`, {
                    method: "DELETE"
                });

                await loadMedicines();

            } catch (error) {
                alert(error.message);
            }
        });

        actionCell.appendChild(deleteButton);
        row.appendChild(actionCell);

        table.appendChild(row);
    });

    $("medicineCount").textContent =
        `${filtered.length} of ${medicines.length} medicines`;

    $("totalMedicines").textContent = medicines.length;

    $("lowStock").textContent = medicines.filter(
        (medicine) => medicine.quantity <= 10
    ).length;
}

// Update stock and expiry alerts
function updateAlerts() {
    const lowItems = medicines.filter(
        (medicine) => medicine.quantity <= 10
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const next30Days = new Date(today);
    next30Days.setDate(today.getDate() + 30);

    const expiryItems = medicines.filter((medicine) => {
        if (!medicine.expiry) return false;

        const expiryDate = new Date(
            medicine.expiry + "T00:00:00"
        );

        return expiryDate >= today && expiryDate <= next30Days;
    });

    $("nearExpiry").textContent = expiryItems.length;

    const alertList = $("alertList");
    alertList.replaceChildren();

    if (lowItems.length === 0 && expiryItems.length === 0) {
        const message = document.createElement("p");
        message.className = "demo-note";
        message.textContent = "No stock or expiry alerts.";
        alertList.appendChild(message);
        return;
    }

    lowItems.forEach((medicine) => {
        const item = document.createElement("div");
        item.className = "alert-item";

        const symbol = document.createElement("span");
        symbol.className = "alert-symbol";
        symbol.textContent = "!";

        const info = document.createElement("div");

        const name = document.createElement("strong");
        name.textContent = medicine.name;

        const description = document.createElement("p");
        description.textContent =
            `Low stock: only ${medicine.quantity} units remain.`;

        info.append(name, description);

        const badge = document.createElement("span");
        badge.className = "badge low-stock";
        badge.textContent = "Low Stock";

        item.append(symbol, info, badge);
        alertList.appendChild(item);
    });

    expiryItems.forEach((medicine) => {
        const item = document.createElement("div");
        item.className = "alert-item";

        const symbol = document.createElement("span");
        symbol.className = "alert-symbol";
        symbol.textContent = "◷";

        const info = document.createElement("div");

        const name = document.createElement("strong");
        name.textContent = medicine.name;

        const description = document.createElement("p");
        description.textContent =
            `Expiry date: ${medicine.expiry}`;

        info.append(name, description);

        const badge = document.createElement("span");
        badge.className = "badge pending";
        badge.textContent = "Near Expiry";

        item.append(symbol, info, badge);
        alertList.appendChild(item);
    });
}

// Open Add Medicine form
$("openAddForm").addEventListener("click", () => {
    $("medicineFormWrap").hidden = false;
    $("formMessage").textContent = "";
    $("medicineName").focus();
});

// Cancel medicine form
$("cancelForm").addEventListener("click", () => {
    $("medicineFormWrap").hidden = true;
    $("medicineForm").reset();
    $("formMessage").textContent = "";
});

// Add medicine
$("medicineForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = $("medicineName").value.trim();
    const batch = $("batchNumber").value.trim();
    const quantity = Number($("medicineQuantity").value);
    const price = Number($("medicinePrice").value);
    const expiry = $("expiryDate").value;

    if (
        !name ||
        !batch ||
        !expiry ||
        !Number.isInteger(quantity) ||
        quantity < 0 ||
        !Number.isFinite(price) ||
        price < 0
    ) {
        $("formMessage").textContent =
            "Please enter valid medicine details.";
        return;
    }

    const duplicateBatch = medicines.some(
        (medicine) =>
            medicine.batch.toLowerCase() === batch.toLowerCase()
    );

    if (duplicateBatch) {
        $("formMessage").textContent =
            "This batch number already exists.";
        return;
    }

    $("formMessage").textContent = "Saving medicine...";

    try {
        await apiRequest("/medicines", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name,
                category: "General",
                quantity,
                price,
                expiry_date: expiry
            })
        });

        $("medicineForm").reset();
        $("medicineFormWrap").hidden = true;
        $("searchMedicine").value = "";

        await loadMedicines();

        $("formMessage").textContent =
            "Medicine saved successfully!";

    } catch (error) {
        $("formMessage").textContent = error.message;
    }
});

// Search
$("searchMedicine").addEventListener("input", renderMedicines);

// Check saved login session
async function checkSession() {
    if (!token) {
        showAuth();
        return;
    }

    try {
        const user = await apiRequest("/me");
        await openDashboard(user);

    } catch (error) {
        logout();
    }
}

// Start application
checkSession();
