import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function AdminSettings({
  familyId,
  family,
  members,
  categories,
  baseCurrency,
  memberSpends,
  amSuperadmin,
  myMemberId,
  onDone,
}) {
  const [limitEdits, setLimitEdits] = useState({}); // memberId -> { amount, period }
  const [catEdits, setCatEdits] = useState({}); // categoryId -> { amount, period }
  const [familyBudget, setFamilyBudget] = useState({
    amount: family.budget_amount ?? "",
    period: family.budget_period ?? "monthly",
  });
  const [newCategory, setNewCategory] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const activeLimitCount = members.filter(
    (m) => m.spending_limit_amount,
  ).length;
  const categoryOptions = categories || [];
  const selectedCategory =
    categoryOptions.find((cat) => cat.id === selectedCategoryId) || null;
  const selectedCategoryEdit = selectedCategory
    ? catEditFor(selectedCategory)
    : null;

  useEffect(() => {
    if (!categoryOptions.length) {
      setSelectedCategoryId("");
      return;
    }

    if (
      !selectedCategoryId ||
      !categoryOptions.some((cat) => cat.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(categoryOptions[0].id);
    }
  }, [categoryOptions, selectedCategoryId]);

  function editFor(member) {
    return (
      limitEdits[member.id] ?? {
        amount: member.spending_limit_amount ?? "",
        period: member.spending_limit_period ?? "monthly",
      }
    );
  }

  function updateEdit(memberId, patch) {
    setLimitEdits((prev) => ({
      ...prev,
      [memberId]: { ...editFor({ id: memberId }), ...patch },
    }));
  }

  function catEditFor(cat) {
    return (
      catEdits[cat.id] ?? {
        amount: cat.budget_amount ?? "",
        period: cat.budget_period ?? "monthly",
      }
    );
  }

  function updateCatEdit(catId, patch) {
    setCatEdits((prev) => ({
      ...prev,
      [catId]: { ...catEditFor({ id: catId }), ...patch },
    }));
  }

  async function saveLimit(member) {
    setBusy(true);
    setError(null);
    try {
      const edit = editFor(member);
      const { error: err } = await supabase
        .from("members")
        .update({
          spending_limit_amount:
            edit.amount === "" ? null : parseFloat(edit.amount),
          spending_limit_period: edit.amount === "" ? null : edit.period,
        })
        .eq("id", member.id);
      if (err) throw err;
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFamilyBudget(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("families")
        .update({
          budget_amount:
            familyBudget.amount === "" ? null : parseFloat(familyBudget.amount),
          budget_period:
            familyBudget.amount === "" ? null : familyBudget.period,
        })
        .eq("id", familyId);
      if (err) throw err;
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCategoryBudget(cat) {
    setBusy(true);
    setError(null);
    try {
      const edit = catEditFor(cat);
      const { error: err } = await supabase
        .from("categories")
        .update({
          budget_amount: edit.amount === "" ? null : parseFloat(edit.amount),
          budget_period: edit.amount === "" ? null : edit.period,
        })
        .eq("id", cat.id);
      if (err) throw err;
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addCategory(e) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("categories")
        .insert({
          family_id: familyId,
          name: newCategory.trim(),
          is_default: false,
        });
      if (err) throw err;
      setNewCategory("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(categoryId) {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("categories")
        .delete()
        .eq("id", categoryId);
      if (err) throw err;
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member, newRole) {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("members")
        .update({ role: newRole })
        .eq("id", member.id);
      if (err) throw err;
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member) {
    if (!confirm(`Remove ${member.display_name} from the family?`)) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("members")
        .delete()
        .eq("id", member.id);
      if (err) throw err;
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-shell">
      <div className="settings-overview">
        <div className="settings-overview-card">
          <span className="settings-overview-label">Family budget</span>
          <strong>
            {familyBudget.amount
              ? `${familyBudget.amount} ${baseCurrency}`
              : "No budget set"}
          </strong>
        </div>
        <div className="settings-overview-card">
          <span className="settings-overview-label">Member limits</span>
          <strong>{activeLimitCount}</strong>
        </div>
        <div className="settings-overview-card">
          <span className="settings-overview-label">Categories</span>
          <strong>{categories.length}</strong>
        </div>
      </div>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="subsection">Family budget</h3>
            <p className="hint">
              Set one shared spending target for the whole household.
            </p>
          </div>
        </div>
        <form
          onSubmit={saveFamilyBudget}
          className="inline-form settings-inline-form"
        >
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="No budget set"
            value={familyBudget.amount}
            onChange={(e) =>
              setFamilyBudget((prev) => ({ ...prev, amount: e.target.value }))
            }
          />
          <select
            value={familyBudget.period}
            onChange={(e) =>
              setFamilyBudget((prev) => ({ ...prev, period: e.target.value }))
            }
          >
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </select>
          <span className="limit-currency">{baseCurrency}</span>
          <button type="submit" disabled={busy}>
            Save
          </button>
        </form>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="subsection">Member spending limits</h3>
            <p className="hint">
              Keep each person aligned with a simple per-period cap.
            </p>
          </div>
        </div>

        {activeLimitCount > 0 && (
          <div className="settings-status-list">
            {members
              .filter((m) => m.spending_limit_amount)
              .map((m) => {
                const spend = memberSpends?.[m.id];
                if (!spend) return null;
                const pct = Math.min(spend.percentUsed * 100, 100);
                return (
                  <div key={m.id} className="status-row">
                    <div className="breakdown-row">
                      <span>{m.display_name}</span>
                      <span>
                        {spend.spent.toFixed(2)} / {spend.limit.toFixed(2)}{" "}
                        {baseCurrency} ({spend.period})
                      </span>
                    </div>
                    <div className="breakdown-bar-track">
                      <div
                        className={`breakdown-bar ${spend.isOverLimit ? "over" : spend.isNearLimit ? "near" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        <div className="settings-stack">
          {members.map((m) => {
            const edit = editFor(m);
            return (
              <div key={m.id} className="setting-item">
                <div className="setting-item-main">
                  <span className="setting-item-title">{m.display_name}</span>
                  <span className="setting-item-meta">
                    {edit.amount
                      ? `${edit.amount} ${baseCurrency} / ${edit.period}`
                      : "No limit set"}
                  </span>
                </div>
                <div className="setting-form">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="No limit"
                    value={edit.amount}
                    onChange={(e) =>
                      updateEdit(m.id, { amount: e.target.value })
                    }
                  />
                  <select
                    value={edit.period}
                    onChange={(e) =>
                      updateEdit(m.id, { period: e.target.value })
                    }
                  >
                    <option value="weekly">weekly</option>
                    <option value="monthly">monthly</option>
                  </select>
                  <span className="limit-currency">{baseCurrency}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveLimit(m)}
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h3 className="subsection">Category budgets</h3>
            <p className="hint">
              Pick a category from the list and edit its budget in one compact
              panel.
            </p>
          </div>
        </div>
        <div className="category-toolbar">
          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="category-picker"
          >
            {categoryOptions.length === 0 ? (
              <option value="">No categories yet</option>
            ) : (
              categoryOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))
            )}
          </select>
          {selectedCategory && !selectedCategory.is_default && (
            <button
              type="button"
              className="remove-btn"
              onClick={() => removeCategory(selectedCategory.id)}
            >
              Remove
            </button>
          )}
        </div>
        {selectedCategory ? (
          <div className="setting-item category-editor">
            <div className="setting-item-main">
              <span className="setting-item-title">
                {selectedCategory.name}
              </span>
              <span className="setting-item-meta">
                {selectedCategoryEdit?.amount
                  ? `${selectedCategoryEdit.amount} ${baseCurrency} / ${selectedCategoryEdit.period}`
                  : "No budget set"}
              </span>
            </div>
            <div className="setting-form category-form">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="No budget"
                value={selectedCategoryEdit?.amount ?? ""}
                onChange={(e) =>
                  updateCatEdit(selectedCategory.id, { amount: e.target.value })
                }
              />
              <select
                value={selectedCategoryEdit?.period ?? "monthly"}
                onChange={(e) =>
                  updateCatEdit(selectedCategory.id, { period: e.target.value })
                }
              >
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveCategoryBudget(selectedCategory)}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="hint">Add a category to start budgeting it.</p>
        )}
        <form
          onSubmit={addCategory}
          className="inline-form settings-inline-form"
        >
          <input
            placeholder="New category name"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            Add Category
          </button>
        </form>
      </section>

      {amSuperadmin && (
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h3 className="subsection">Manage admins</h3>
              <p className="hint">
                Only the superadmin can promote or demote admins here.
              </p>
            </div>
          </div>
          <div className="settings-stack">
            {members
              .filter((m) => m.role !== "superadmin")
              .map((m) => (
                <div key={m.id} className="setting-item setting-item-stack">
                  <div className="setting-item-main">
                    <span className="setting-item-title">{m.display_name}</span>
                    <span className="setting-item-meta">{m.role}</span>
                  </div>
                  <div className="setting-form">
                    {m.role === "member" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => changeRole(m, "admin")}
                      >
                        Promote
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => changeRole(m, "member")}
                      >
                        Demote
                      </button>
                    )}
                    {m.id !== myMemberId && (
                      <button
                        type="button"
                        className="remove-btn"
                        disabled={busy}
                        onClick={() => removeMember(m)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {error && <p className="status error">{error}</p>}
    </div>
  );
}
