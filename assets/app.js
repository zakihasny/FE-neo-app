(function () {
  'use strict'

  var config = window.NEO_APP_CONFIG || {}
  var apiBaseUrl = config.apiBaseUrl || '/api/'

  function apiUrl(path) {
    var normalizedBase = apiBaseUrl.endsWith('/') ? apiBaseUrl : apiBaseUrl + '/'
    var base = new URL(normalizedBase, window.location.href)
    return new URL(String(path).replace(/^\/+/, ''), base).toString()
  }

  async function apiRequest(path, options) {
    var controller = new AbortController()
    var timeout = window.setTimeout(function () {
      controller.abort()
    }, 8000)

    try {
      var response = await fetch(apiUrl(path), Object.assign({
        headers: { accept: 'application/json' },
        signal: controller.signal
      }, options || {}))

      var payload = await response.json().catch(function () {
        return {}
      })

      if (!response.ok) {
        throw new Error(payload.statusMessage || payload.message || 'Request API gagal.')
      }

      return payload
    } finally {
      window.clearTimeout(timeout)
    }
  }

  function setApiStatus(state, label) {
    document.querySelectorAll('[data-api-indicator]').forEach(function (indicator) {
      indicator.classList.remove('is-connected', 'is-error')
      if (state === 'connected') indicator.classList.add('is-connected')
      if (state === 'error') indicator.classList.add('is-error')
      var text = indicator.querySelector('[data-api-label]')
      if (text) text.textContent = label
    })
  }

  function initializeMenu() {
    var toggle = document.querySelector('[data-menu-toggle]')
    var nav = document.querySelector('.main-nav')
    if (!toggle || !nav) return

    function closeMenu() {
      nav.classList.remove('is-open')
      toggle.setAttribute('aria-expanded', 'false')
      toggle.setAttribute('aria-label', 'Buka navigasi')
    }

    toggle.addEventListener('click', function () {
      var open = !nav.classList.contains('is-open')
      nav.classList.toggle('is-open', open)
      toggle.setAttribute('aria-expanded', String(open))
      toggle.setAttribute('aria-label', open ? 'Tutup navigasi' : 'Buka navigasi')
    })

    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target) && !toggle.contains(event.target)) closeMenu()
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu()
    })

    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) closeMenu()
    })
  }

  async function initializeHome() {
    var note = document.getElementById('summary-note')

    try {
      var summary = await apiRequest('summary')
      document.getElementById('metric-employees').textContent = String(summary.employees || 0)
      document.getElementById('metric-sites').textContent = String(summary.sites || 0)
      document.getElementById('metric-devices').textContent = String(summary.devices || 0)
      note.textContent = 'Terhubung ke API'
      setApiStatus('connected', 'API terhubung')
    } catch (error) {
      note.textContent = 'API belum tersedia'
      setApiStatus('error', 'API tidak tersedia')
    }
  }

  var queryExamples = {
    employees: "SELECT\n  e.employee_id,\n  e.full_name,\n  e.job_title,\n  s.site_name,\n  st.seat_code,\n  sal.salary_grade\nFROM employee_app.employees AS e\nJOIN employee_app.sites AS s ON s.site_id = e.site_id\nJOIN employee_app.seating AS st ON st.seating_id = e.seating_id\nJOIN employee_app.salaries AS sal ON sal.salary_id = e.salary_id\nORDER BY e.employee_id\nLIMIT 200;",
    devices: "SELECT\n  e.full_name,\n  d.device_type,\n  d.device_brand,\n  d.serial_number,\n  d.assigned_date\nFROM employee_app.employees AS e\nJOIN employee_app.employee_devices AS d ON d.employee_id = e.employee_id\nORDER BY e.full_name, d.device_type\nLIMIT 200;",
    sites: "SELECT\n  s.site_name,\n  s.city,\n  count(e.employee_id) AS employee_count\nFROM employee_app.sites AS s\nLEFT JOIN employee_app.employees AS e ON e.site_id = s.site_id\nGROUP BY s.site_id, s.site_name, s.city\nORDER BY employee_count DESC\nLIMIT 200;"
  }

  function formatCell(value) {
    if (value === null) return 'NULL'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  function renderQueryResult(result) {
    var frame = document.getElementById('query-table-frame')
    var empty = document.getElementById('query-empty')
    var table = document.getElementById('query-result-table')
    var meta = document.getElementById('result-meta')

    table.replaceChildren()
    meta.textContent = String(result.rowCount || 0) + ' baris | ' + String(result.durationMs || 0) + ' ms'

    if (!Array.isArray(result.rows) || result.rows.length === 0) {
      empty.textContent = 'Query berhasil dan tidak menghasilkan baris.'
      empty.classList.remove('is-hidden')
      frame.classList.add('is-hidden')
      return
    }

    var head = document.createElement('thead')
    var headRow = document.createElement('tr')
    ;(result.columns || []).forEach(function (column) {
      var th = document.createElement('th')
      th.scope = 'col'
      th.textContent = String(column)
      headRow.appendChild(th)
    })
    head.appendChild(headRow)

    var body = document.createElement('tbody')
    result.rows.forEach(function (row) {
      var tr = document.createElement('tr')
      row.forEach(function (cell) {
        var td = document.createElement('td')
        td.textContent = formatCell(cell)
        tr.appendChild(td)
      })
      body.appendChild(tr)
    })

    table.append(head, body)
    empty.classList.add('is-hidden')
    frame.classList.remove('is-hidden')
  }

  function initializeQuery() {
    var form = document.getElementById('query-form')
    var editor = document.getElementById('sql-editor')
    var button = document.getElementById('run-query')
    var errorBox = document.getElementById('query-error')

    document.querySelectorAll('[data-query-example]').forEach(function (exampleButton) {
      exampleButton.addEventListener('click', function () {
        editor.value = queryExamples[exampleButton.dataset.queryExample]
        editor.focus()
      })
    })

    form.addEventListener('submit', async function (event) {
      event.preventDefault()
      errorBox.classList.add('is-hidden')
      button.disabled = true
      button.textContent = 'Menjalankan...'

      try {
        var result = await apiRequest('query', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sql: editor.value })
        })
        renderQueryResult(result)
        setApiStatus('connected', 'API terhubung')
      } catch (error) {
        errorBox.textContent = error.message || 'Query tidak dapat dijalankan.'
        errorBox.classList.remove('is-hidden')
        setApiStatus('error', 'API tidak tersedia')
      } finally {
        button.disabled = false
        button.textContent = 'Jalankan query'
      }
    })
  }

  function createOption(value, label) {
    var option = document.createElement('option')
    option.value = String(value)
    option.textContent = label
    return option
  }

  function setFormMessage(form, type, text) {
    var message = form.querySelector('[data-form-message]')
    message.className = 'message'
    if (type === 'error') message.classList.add('message-error')
    if (type === 'success') message.classList.add('message-success')
    message.textContent = text
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds)
    })
  }

  async function waitForJob(jobId) {
    for (var attempt = 0; attempt < 20; attempt += 1) {
      var job = await apiRequest('jobs/' + encodeURIComponent(jobId))
      if (job.status === 'completed') return job
      if (job.status === 'failed') throw new Error(job.message || 'Proses penyimpanan gagal.')
      await delay(1500)
    }
    return null
  }

  async function initializeInput() {
    var forms = Array.from(document.querySelectorAll('[data-entry-form]'))
    var tabs = Array.from(document.querySelectorAll('[data-entry-type]'))
    var integrityPanels = Array.from(document.querySelectorAll('[data-integrity-panel]'))
    var employeeForm = document.getElementById('employee-form')
    var siteForm = document.getElementById('site-form')
    var deviceForm = document.getElementById('device-form')
    var siteSelect = document.getElementById('employee-site-id')
    var salarySelect = document.getElementById('salary-id')
    var seatingSelect = document.getElementById('seating-id')
    var deviceEmployeeSelect = document.getElementById('device-employee-id')
    var deviceSiteId = document.getElementById('device-site-id')
    var deviceSiteName = document.getElementById('device-site-name')
    var seating = []
    var employees = []

    var formDefinitions = {
      employee: {
        form: employeeForm,
        endpoint: 'employees',
        label: 'Pegawai',
        submittingLabel: 'Mengirim pegawai...'
      },
      site: {
        form: siteForm,
        endpoint: 'sites',
        label: 'Site',
        submittingLabel: 'Mengirim site...'
      },
      device: {
        form: deviceForm,
        endpoint: 'devices',
        label: 'Device',
        submittingLabel: 'Mengirim device...'
      }
    }

    function selectEntryType(type, updateUrl) {
      if (!formDefinitions[type]) type = 'employee'
      tabs.forEach(function (tab) {
        var active = tab.dataset.entryType === type
        tab.classList.toggle('is-active', active)
        tab.setAttribute('aria-selected', String(active))
        tab.setAttribute('tabindex', active ? '0' : '-1')
      })
      forms.forEach(function (form) {
        form.classList.toggle('is-hidden', form.dataset.entryForm !== type)
      })
      integrityPanels.forEach(function (panel) {
        panel.classList.toggle('is-hidden', panel.dataset.integrityPanel !== type)
      })

      if (updateUrl && window.history && window.history.replaceState) {
        var url = new URL(window.location.href)
        url.searchParams.set('type', type)
        window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      }
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        selectEntryType(tab.dataset.entryType, true)
      })
      tab.addEventListener('keydown', function (event) {
        var nextIndex = null
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
        if (event.key === 'Home') nextIndex = 0
        if (event.key === 'End') nextIndex = tabs.length - 1
        if (nextIndex === null) return
        event.preventDefault()
        tabs[nextIndex].focus()
        selectEntryType(tabs[nextIndex].dataset.entryType, true)
      })
    })

    var initialType = new URL(window.location.href).searchParams.get('type') || 'employee'
    selectEntryType(initialType, false)

    function populateSeating() {
      var siteId = Number(siteSelect.value)
      seatingSelect.replaceChildren(createOption('', 'Pilih tempat duduk'))
      seating.filter(function (seat) {
        return Number(seat.site_id) === siteId
      }).forEach(function (seat) {
        seatingSelect.appendChild(createOption(seat.seating_id, seat.seat_code + ' | Lantai ' + seat.floor_number))
      })
      seatingSelect.disabled = !siteId
    }

    function populateDeviceSite() {
      var employeeId = Number(deviceEmployeeSelect.value)
      var employee = employees.find(function (item) {
        return Number(item.employee_id) === employeeId
      })
      deviceSiteId.value = employee ? String(employee.site_id) : ''
      deviceSiteName.value = employee
        ? employee.site_name
        : 'Pilih pegawai terlebih dahulu'
    }

    function populateMeta(meta) {
      seating = Array.isArray(meta.seating) ? meta.seating : []
      employees = Array.isArray(meta.employees) ? meta.employees : []

      siteSelect.replaceChildren(createOption('', 'Pilih lokasi'))
      ;(meta.sites || []).forEach(function (site) {
        siteSelect.appendChild(createOption(site.site_id, site.site_name + ' | ' + site.city))
      })

      salarySelect.replaceChildren(createOption('', 'Pilih grade'))
      var rupiah = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
      })
      ;(meta.salaries || []).forEach(function (salary) {
        salarySelect.appendChild(createOption(
          salary.salary_id,
          salary.salary_grade + ' | ' + rupiah.format(salary.basic_salary)
        ))
      })

      deviceEmployeeSelect.replaceChildren(createOption('', 'Pilih pegawai'))
      employees.forEach(function (employee) {
        deviceEmployeeSelect.appendChild(createOption(
          employee.employee_id,
          employee.full_name + ' | ' + employee.site_name
        ))
      })

      siteSelect.disabled = false
      salarySelect.disabled = false
      deviceEmployeeSelect.disabled = false
      forms.forEach(function (form) {
        form.querySelector('[data-submit-button]').disabled = false
      })
      populateSeating()
      populateDeviceSite()
    }

    async function loadMeta() {
      var meta = await apiRequest('meta')
      populateMeta(meta)
      setApiStatus('connected', 'API terhubung')
    }

    siteSelect.addEventListener('change', populateSeating)
    deviceEmployeeSelect.addEventListener('change', populateDeviceSite)

    employeeForm.addEventListener('reset', function () {
      window.setTimeout(populateSeating, 0)
    })

    deviceForm.addEventListener('reset', function () {
      window.setTimeout(populateDeviceSite, 0)
    })

    try {
      await loadMeta()
    } catch (error) {
      setFormMessage(employeeForm, 'error', 'Referensi database tidak tersedia. Periksa konfigurasi API dan koneksi NEO DB.')
      setApiStatus('error', 'API tidak tersedia')
    }

    function requestFromForm(resourceType, form) {
      var formData = new FormData(form)
      var idempotencyKey = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(16).slice(2)

      if (resourceType === 'employee') {
        return {
          fullName: String(formData.get('fullName') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          jobTitle: String(formData.get('jobTitle') || '').trim(),
          hiredDate: String(formData.get('hiredDate') || ''),
          siteId: Number(formData.get('siteId')),
          salaryId: Number(formData.get('salaryId')),
          seatingId: Number(formData.get('seatingId')),
          idempotencyKey: idempotencyKey
        }
      }

      if (resourceType === 'site') {
        return {
          siteName: String(formData.get('siteName') || '').trim(),
          city: String(formData.get('city') || '').trim(),
          address: String(formData.get('address') || '').trim(),
          idempotencyKey: idempotencyKey
        }
      }

      return {
        employeeId: Number(formData.get('employeeId')),
        siteId: Number(formData.get('siteId')),
        deviceType: String(formData.get('deviceType') || '').trim(),
        deviceBrand: String(formData.get('deviceBrand') || '').trim(),
        serialNumber: String(formData.get('serialNumber') || '').trim(),
        assignedDate: String(formData.get('assignedDate') || ''),
        idempotencyKey: idempotencyKey
      }
    }

    Object.keys(formDefinitions).forEach(function (resourceType) {
      var definition = formDefinitions[resourceType]
      var form = definition.form
      form.addEventListener('submit', async function (event) {
        event.preventDefault()
        var submitButton = form.querySelector('[data-submit-button]')
        var defaultLabel = submitButton.textContent
        submitButton.disabled = true
        submitButton.textContent = definition.submittingLabel

        try {
          var response = await apiRequest(definition.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(requestFromForm(resourceType, form))
          })

          if (!response.jobId) throw new Error('API tidak mengembalikan job ID.')

          setFormMessage(form, 'success', response.message + ' Job ID: ' + response.jobId + '.')
          var completed = await waitForJob(response.jobId)
          if (!completed) {
            setFormMessage(form, 'success', 'Request masih diproses. Job ID: ' + response.jobId + '.')
            return
          }

          setFormMessage(
            form,
            'success',
            (completed.message || definition.label + ' berhasil ditambahkan.') +
              ' ID: ' + completed.resourceId + '.'
          )
          form.reset()
          await loadMeta().catch(function () {
            setApiStatus('error', 'Referensi perlu dimuat ulang')
          })
        } catch (error) {
          setFormMessage(form, 'error', error.message || 'Data tidak dapat dikirim.')
        } finally {
          submitButton.disabled = false
          submitButton.textContent = defaultLabel
        }
      })
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    initializeMenu()
    var page = document.body.dataset.page
    if (page === 'home') initializeHome()
    if (page === 'query') initializeQuery()
    if (page === 'input') initializeInput()
  })
})()
