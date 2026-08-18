import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../AuthContext";
import { isAdmin } from "../lib/roles";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "../styles/statistics.css";

export default function Statistics({ familyId }) {
  const { session } = useAuth();
  const [family, setFamily] = useState(null);
  const [members, setMembers] = useState([]);
  const [myMember, setMyMember] = useState(null);

  // Filters
  const [selectedMember, setSelectedMember] = useState("all");
  const [dateRange, setDateRange] = useState("30days");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Data
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartHeight, setChartHeight] = useState(300);
  const [pieRadius, setPieRadius] = useState(100);

  // Computed data
  const [spendingTrend, setSpendingTrend] = useState([]);
  const [categoryBreakdown, setcategoryBreakdown] = useState([]);
  const [memberComparison, setMemberComparison] = useState([]);
  const [balanceHistory, setBalanceHistory] = useState([]);
  const [cashFlowMetrics, setCashFlowMetrics] = useState({});

  const COLORS = [
    "#5b8def",
    "#77a1f4",
    "#3ecf8e",
    "#eab04d",
    "#ef6a5f",
    "#a78bfa",
    "#06b6d4",
  ];

  // Responsive chart heights
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 480) {
        setChartHeight(160);
        setPieRadius(60);
      } else if (window.innerWidth < 768) {
        setChartHeight(200);
        setPieRadius(70);
      } else {
        setChartHeight(300);
        setPieRadius(100);
      }
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Get date range
  function getDateRangeValues() {
    const end = new Date();
    let start = new Date();

    if (dateRange === "7days") {
      start.setDate(end.getDate() - 7);
    } else if (dateRange === "30days") {
      start.setDate(end.getDate() - 30);
    } else if (dateRange === "3months") {
      start.setMonth(end.getMonth() - 3);
    } else if (dateRange === "custom") {
      start = new Date(customStartDate);
    }

    return { start, end };
  }

  // Load family, members, transactions
  async function loadData() {
    try {
      setLoading(true);

      // Get family
      const { data: familyData } = await supabase
        .from("families")
        .select("*")
        .eq("id", familyId)
        .single();
      setFamily(familyData);

      // Get members
      const { data: membersData } = await supabase
        .from("members")
        .select("*")
        .eq("family_id", familyId);
      setMembers(membersData || []);

      // Get current user's member record
      if (session?.user?.id) {
        const { data: myMemberData } = await supabase
          .from("members")
          .select("*")
          .eq("family_id", familyId)
          .eq("user_id", session.user.id)
          .single();
        setMyMember(myMemberData);
      }

      // Get wallet
      const { data: walletData } = await supabase
        .from("wallets")
        .select("*")
        .eq("family_id", familyId)
        .single();
      setWallet(walletData);

      // Get categories
      const { data: categoriesData } = await supabase
        .from("categories")
        .select("*")
        .eq("family_id", familyId);
      setCategories(categoriesData || []);

      // Get transactions with date filtering
      const { start, end } = getDateRangeValues();
      let query = supabase
        .from("transactions")
        .select("*")
        .eq("family_id", familyId)
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString());

      if (selectedMember !== "all") {
        query = query.eq("member_id", selectedMember);
      }

      const { data: txnData } = await query.order("created_at", {
        ascending: true,
      });
      setTransactions(txnData || []);

      setLoading(false);
    } catch (error) {
      console.error("Error loading statistics:", error);
      setLoading(false);
    }
  }

  // Load initial data
  useEffect(() => {
    if (familyId && session?.user?.id) {
      loadData();
    }
  }, [
    familyId,
    session,
    selectedMember,
    dateRange,
    customStartDate,
    customEndDate,
  ]);

  // Process transactions into charts
  useEffect(() => {
    if (transactions.length === 0) {
      setSpendingTrend([]);
      setcategoryBreakdown([]);
      setMemberComparison([]);
      setCashFlowMetrics({
        totalSpent: 0,
        totalDeposits: 0,
        netChange: 0,
        avgDailySpend: 0,
      });
      return;
    }

    // 1. Spending Trend (daily)
    const dailySpend = {};
    transactions.forEach((txn) => {
      const date = new Date(txn.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      dailySpend[date] = (dailySpend[date] || 0) + parseFloat(txn.amount);
    });

    const trend = Object.entries(dailySpend)
      .map(([date, amount]) => ({
        date,
        amount: parseFloat(amount.toFixed(2)),
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    setSpendingTrend(trend);

    // 2. Category Breakdown
    const categorySpend = {};
    transactions.forEach((txn) => {
      const categoryName =
        categories.find((c) => c.id === txn.category_id)?.name ||
        "Uncategorized";
      categorySpend[categoryName] =
        (categorySpend[categoryName] || 0) + parseFloat(txn.amount);
    });

    const breakdown = Object.entries(categorySpend)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
    setcategoryBreakdown(breakdown);

    // 3. Member Comparison
    const memberSpend = {};
    transactions.forEach((txn) => {
      const member = members.find((m) => m.id === txn.member_id);
      if (member) {
        memberSpend[member.display_name] =
          (memberSpend[member.display_name] || 0) + parseFloat(txn.amount);
      }
    });

    const comparison = Object.entries(memberSpend)
      .map(([name, amount]) => ({
        name,
        amount: parseFloat(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount);
    setMemberComparison(comparison);

    // 4. Cash Flow Metrics
    const totalSpent = transactions.reduce(
      (sum, t) => sum + parseFloat(t.amount),
      0,
    );
    const { start, end } = getDateRangeValues();
    const daysInRange = Math.max(
      1,
      Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
    );
    const avgDailySpend = totalSpent / daysInRange;

    setCashFlowMetrics({
      totalSpent: parseFloat(totalSpent.toFixed(2)),
      totalDeposits: wallet?.balance_cache || 0,
      netChange: (wallet?.balance_cache || 0) - totalSpent,
      avgDailySpend: parseFloat(avgDailySpend.toFixed(2)),
    });
  }, [transactions, categories, members]);

  const amAdmin = myMember && isAdmin(myMember.role);
  const { start, end } = getDateRangeValues();

  if (loading) {
    return (
      <div className="stats-container">
        <p>Loading statistics...</p>
      </div>
    );
  }

  return (
    <div className="stats-container">
      <div className="stats-header">
        <h1>Statistics</h1>
        <p>Family financial overview and insights</p>
      </div>

      {/* Filters */}
      <div className="stats-filters">
        {/* Member Filter */}
        <div className="filter-group">
          <label htmlFor="member-filter">Member</label>
          <select
            id="member-filter"
            value={selectedMember}
            onChange={(e) => setSelectedMember(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>

        {/* Date Range Filter */}
        <div className="filter-group">
          <label htmlFor="date-filter">Period</label>
          <select
            id="date-filter"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="filter-select"
          >
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="3months">Last 3 Months</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {/* Custom Date Range */}
        {dateRange === "custom" && (
          <>
            <div className="filter-group">
              <label htmlFor="start-date">Start Date</label>
              <input
                id="start-date"
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="filter-input"
              />
            </div>
            <div className="filter-group">
              <label htmlFor="end-date">End Date</label>
              <input
                id="end-date"
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="filter-input"
              />
            </div>
          </>
        )}
      </div>

      {/* Summary Cards */}
      <div className="stats-summary-cards">
        <div className="summary-card">
          <div className="summary-label">Total Spent</div>
          <div className="summary-value">${cashFlowMetrics.totalSpent}</div>
          <div className="summary-meta">{transactions.length} transactions</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Family Balance</div>
          <div className="summary-value">
            ${(wallet?.balance_cache || 0).toFixed(2)}
          </div>
          <div className="summary-meta">Current balance</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Avg Daily Spend</div>
          <div className="summary-value">${cashFlowMetrics.avgDailySpend}</div>
          <div className="summary-meta">Average per day</div>
        </div>

        <div className="summary-card">
          <div className="summary-label">Net Change</div>
          <div
            className={`summary-value ${cashFlowMetrics.netChange >= 0 ? "positive" : "negative"}`}
          >
            {cashFlowMetrics.netChange >= 0 ? "+" : ""}$
            {cashFlowMetrics.netChange.toFixed(2)}
          </div>
          <div className="summary-meta">Period change</div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="stats-charts">
        {/* Spending Trend */}
        <div className="chart-card">
          <h3>Spending Trend</h3>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={spendingTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--surface-raised)",
                  border: `1px solid var(--border)`,
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "var(--text)" }}
              />
              <Line
                type="monotone"
                dataKey="amount"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={{ fill: "var(--accent)", r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Category Breakdown */}
        <div className="chart-card">
          <h3>Spending by Category</h3>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <PieChart>
              <Pie
                data={categoryBreakdown}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={
                  window.innerWidth > 768
                    ? ({ name, value }) => `${name}: $${value}`
                    : false
                }
                outerRadius={pieRadius}
                fill="#8884d8"
                dataKey="value"
              >
                {categoryBreakdown.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--surface-raised)",
                  border: `1px solid var(--border)`,
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "var(--text)" }}
                formatter={(value, name, props) => [
                  `$${value}`,
                  props.payload.name,
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
          {window.innerWidth <= 768 && categoryBreakdown.length > 0 && (
            <div className="chart-legend">
              <div className="legend-items">
                {categoryBreakdown.map((item, idx) => (
                  <div key={item.name} className="legend-item">
                    <span
                      className="legend-color"
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <span className="legend-label">
                      {item.name}: ${item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Member Comparison */}
        {amAdmin && memberComparison.length > 0 && (
          <div className="chart-card full-width">
            <h3>Member Spending Comparison</h3>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={memberComparison}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--surface-raised)",
                    border: `1px solid var(--border)`,
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "var(--text)" }}
                />
                <Bar
                  dataKey="amount"
                  fill="var(--accent)"
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Balance History */}
        <div className="chart-card full-width">
          <h3>Family Balance Overview</h3>
          <div className="balance-info">
            <div>
              Current Balance:{" "}
              <strong>${(wallet?.balance_cache || 0).toFixed(2)}</strong>
            </div>
            <div>
              Period: {start.toLocaleDateString()} — {end.toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {transactions.length === 0 && (
        <div className="empty-state">
          <p>No transactions found for the selected period and filters.</p>
        </div>
      )}
    </div>
  );
}
