"use client";

import { type ChangeEvent, type CSSProperties, FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, differenceInCalendarDays, format, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { Building2, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, CirclePlus, Download, GripVertical, History, LockKeyhole, LogIn, LogOut, Mail, MapPin, MoreHorizontal, MoreVertical, Pencil, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Undo2, UserRound, Users, WalletCards, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";

type Property = { id: number; name: string; address: string; roomOptions: string; highlightColor: string; nightlyRateCents: number; defaultCheckInTime: string; defaultCheckOutTime: string; sortOrder: number };
type BookingStatus = "confirmed" | "pending" | "blocked" | "cancelled" | "checked_out";
type Booking = {
  id: number;
  propertyId: number;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  guestCount: number;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  nightlyPriceCents: number;
  totalPriceCents: number;
  amountPaidCents: number;
  paymentMethod: "cash" | "credit_card" | "unspecified";
  status: BookingStatus;
  notes: string;
  roomLabel: string;
  bookingColor: string;
  cleaningStatus: "clean" | "not_clean";
  fees: string;
};
type BookingFee = { name: string; amountCents: number };
type BackupSnapshot = { id: number; reason: string; createdAt: string };

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const defaultRoomOptions = ["Single room", "Master room", "Full"];
const bookingColors = ["#246BFD", "#EC6596", "#8B5CF6", "#16A085", "#E38B20", "#52637A"];

function roomsFor(property: Property | null) {
  if (!property) return defaultRoomOptions;
  try {
    const options = JSON.parse(property.roomOptions);
    return Array.isArray(options) && options.length ? options.map(String) : defaultRoomOptions;
  } catch {
    return defaultRoomOptions;
  }
}

function canonicalRoom(label: string) {
  const normalized = label.trim().toLocaleLowerCase();
  if (["full", "全包", "entire property", "whole property"].includes(normalized)) return "full";
  if (["single", "single room", "單間", "单间"].includes(normalized)) return "single";
  if (["master", "master room", "studio", "studio room", "suite", "套房"].includes(normalized)) return "master";
  return normalized;
}

function isWholeProperty(label: string) {
  return canonicalRoom(label) === "full";
}

function unavailableRoomsForRange(property: Property | null, bookings: Booking[], start: string, end: string, ignoreBookingId?: number | null) {
  const options = roomsFor(property);
  const overlaps = bookings.filter((booking) => booking.id !== ignoreBookingId && booking.status !== "cancelled" && booking.checkIn < end && booking.checkOut > start);
  const occupied = new Set(overlaps.map((booking) => canonicalRoom(booking.roomLabel)));
  const fullIsBooked = overlaps.some((booking) => isWholeProperty(booking.roomLabel));
  return new Set(options.filter((option) => {
    const normalized = canonicalRoom(option);
    return fullIsBooked || (normalized === "full" && overlaps.length > 0) || occupied.has(normalized);
  }));
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function feesFor(booking: Booking): BookingFee[] {
  try {
    const value = JSON.parse(booking.fees || "[]");
    return Array.isArray(value) ? value.filter((fee) => fee && typeof fee.name === "string" && Number.isInteger(fee.amountCents)) : [];
  } catch {
    return [];
  }
}

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function displayTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
}

export default function BookingCalendar({ displayName, email, signOutPath }: { displayName: string; email: string; signOutPath: string }) {
  const [activeTab, setActiveTab] = useState<"today" | "calendar" | "properties" | "more">("properties");
  const [morePage, setMorePage] = useState<"menu" | "earnings" | "backup">("menu");
  const [earningsProperty, setEarningsProperty] = useState("all");
  const [earningsRange, setEarningsRange] = useState<1 | 3 | 6 | 12>(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [propertyDialog, setPropertyDialog] = useState(false);
  const [draggingPropertyId, setDraggingPropertyId] = useState<number | null>(null);
  const propertyOrderRef = useRef<Property[]>([]);
  const dragStartOrderRef = useRef<Property[]>([]);
  const [deletePropertyDialog, setDeletePropertyDialog] = useState(false);
  const [deleteBookingDialog, setDeleteBookingDialog] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<number | null>(null);
  const [bookingDialog, setBookingDialog] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<number | null>(null);
  const [searchDialog, setSearchDialog] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<"all" | "unpaid" | "partial">("all");
  const [todayView, setTodayView] = useState<"today" | "upcoming">("today");
  const [hideCheckedOut, setHideCheckedOut] = useState(false);
  const [accountDialog, setAccountDialog] = useState(false);
  const [backupsDialog, setBackupsDialog] = useState(false);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [backupToRestore, setBackupToRestore] = useState<BackupSnapshot | null>(null);
  const [importBackup, setImportBackup] = useState<{ fileName: string; data: Record<string, unknown>; properties: number; bookings: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [listingSearch, setListingSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [dayBookings, setDayBookings] = useState<Booking[]>([]);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [propertyRate, setPropertyRate] = useState("");
  const [propertyCheckInTime, setPropertyCheckInTime] = useState("15:00");
  const [propertyCheckOutTime, setPropertyCheckOutTime] = useState("11:00");
  const [propertyColor, setPropertyColor] = useState("#246bfd");
  const [propertyRoomOptions, setPropertyRoomOptions] = useState<string[]>(defaultRoomOptions);
  const [newRoomOption, setNewRoomOption] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestCount, setGuestCount] = useState("1");
  const [checkIn, setCheckIn] = useState(iso(new Date()));
  const [checkOut, setCheckOut] = useState(iso(addDays(new Date(), 1)));
  const [checkInTime, setCheckInTime] = useState("15:00");
  const [checkOutTime, setCheckOutTime] = useState("11:00");
  const [nightlyPrice, setNightlyPrice] = useState("");
  const [bookingFees, setBookingFees] = useState<{ id: string; name: string; amount: string }[]>([]);
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMode, setPaymentMode] = useState<"full" | "partial" | "unpaid">("full");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit_card" | "unspecified">("cash");
  const [bookingStatus, setBookingStatus] = useState<"confirmed" | "pending" | "blocked">("confirmed");
  const [roomLabel, setRoomLabel] = useState("Full");
  const [bookingColor, setBookingColor] = useState(bookingColors[0]);
  const [cleaningStatus, setCleaningStatus] = useState<"clean" | "not_clean">("not_clean");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selectedProperty = properties.find((property) => property.id === selectedPropertyId) ?? null;
  const editingBooking = allBookings.find((booking) => booking.id === editingBookingId) ?? null;
  const formProperty = editingBooking ? properties.find((property) => property.id === editingBooking.propertyId) ?? null : selectedProperty;

  const loadProperties = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/properties");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load properties");
      setProperties(data.properties);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load properties");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBookings = useCallback(async () => {
    if (!selectedPropertyId) {
      setBookings([]);
      return;
    }
    const response = await fetch(`/api/bookings?propertyId=${selectedPropertyId}`);
    const data = await response.json();
    if (response.ok) setBookings(data.bookings);
    else toast.error(data.error ?? "Could not load bookings");
  }, [selectedPropertyId]);

  const loadAllBookings = useCallback(async () => {
    const response = await fetch("/api/bookings");
    const data = await response.json();
    if (response.ok) setAllBookings(data.bookings);
    else toast.error(data.error ?? "Could not load bookings");
  }, []);

  useEffect(() => { void loadProperties(); }, [loadProperties]);
  useEffect(() => { void loadBookings(); }, [loadBookings]);
  useEffect(() => { void loadAllBookings(); }, [loadAllBookings]);
  useEffect(() => { if (activeTab === "more") void loadBackupList(); }, [activeTab]);
  useEffect(() => { setHideCheckedOut(window.localStorage.getItem("roomie-hide-checked-out") === "true"); }, []);
  useEffect(() => { propertyOrderRef.current = properties; }, [properties]);

  const calendarDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(month));
    return Array.from({ length: 42 }, (_, index) => addDays(first, index));
  }, [month]);

  const activeBookings = bookings.filter((booking) => booking.status !== "cancelled");
  const calendarBookings = activeBookings.filter((booking) => !hideCheckedOut || booking.status !== "checked_out");
  const bookingLaneById = useMemo(() => {
    const assignments = new Map<number, number>();
    const assignedBookings: Booking[] = [];

    [...calendarBookings]
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut) || a.id - b.id)
      .forEach((booking) => {
        const roomKey = canonicalRoom(booking.roomLabel);
        const preferredLane = roomKey === "full" ? 0 : roomKey === "single" ? 1 : roomKey === "master" ? 3 : 2;
        const occupiedLanes = new Set(
          assignedBookings
            .filter((assigned) => assigned.checkIn <= booking.checkOut && assigned.checkOut >= booking.checkIn)
            .map((assigned) => assignments.get(assigned.id)),
        );
        const lanePreferences = preferredLane === 0
          ? [0, 2, 3, 1]
          : preferredLane === 1
            ? [1, 2, 0, 3]
            : preferredLane === 3
              ? [3, 0, 2, 1]
              : [2, 0, 1, 3];
        const lane = lanePreferences.find((candidate) => !occupiedLanes.has(candidate));
        if (lane !== undefined) {
          assignments.set(booking.id, lane);
          assignedBookings.push(booking);
        }
      });

    return assignments;
  }, [calendarBookings, selectedProperty]);

  function bookingsForDate(date: Date) {
    const dateValue = iso(date);
    return calendarBookings.filter((booking) => booking.checkIn <= dateValue && booking.checkOut >= dateValue);
  }

  function openNewBooking(startDate: Date, endDate: Date) {
    const start = iso(startDate);
    const end = iso(endDate);
    const options = roomsFor(selectedProperty);
    const unavailable = unavailableRoomsForRange(selectedProperty, activeBookings, start, end);
    const firstAvailableRoom = options.find((option) => !unavailable.has(option));
    if (!firstAvailableRoom) {
      toast.error("No rental options are available for all selected nights");
      return false;
    }
    setEditingBookingId(null);
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setGuestCount("1");
    setCheckIn(start);
    setCheckOut(end);
    setCheckInTime(selectedProperty?.defaultCheckInTime || "15:00");
    setCheckOutTime(selectedProperty?.defaultCheckOutTime || "11:00");
    setNightlyPrice(selectedProperty ? String(selectedProperty.nightlyRateCents / 100 || "") : "");
    setBookingFees([]);
    setAmountPaid("");
    setPaymentMode("full");
    setPaymentMethod("cash");
    setRoomLabel(firstAvailableRoom);
    setBookingColor(bookingColors[Math.max(0, options.indexOf(firstAvailableRoom)) % bookingColors.length]);
    setCleaningStatus("not_clean");
    setBookingStatus("confirmed");
    setNotes("");
    setBookingDialog(true);
    return true;
  }

  function openEditBooking(booking: Booking) {
    setEditingBookingId(booking.id);
    setGuestName(booking.guestName);
    setGuestPhone(booking.guestPhone);
    setGuestEmail(booking.guestEmail);
    setGuestCount(String(booking.guestCount));
    setCheckIn(booking.checkIn);
    setCheckOut(booking.checkOut);
    setCheckInTime(booking.checkInTime || "15:00");
    setCheckOutTime(booking.checkOutTime || "11:00");
    setNightlyPrice(String(booking.nightlyPriceCents / 100));
    setBookingFees(feesFor(booking).map((fee, index) => ({ id: `${booking.id}-${index}`, name: fee.name, amount: String(fee.amountCents / 100) })));
    setAmountPaid(String(booking.amountPaidCents / 100 || ""));
    setPaymentMode(booking.amountPaidCents >= booking.totalPriceCents ? "full" : booking.amountPaidCents === 0 ? "unpaid" : "partial");
    setPaymentMethod(booking.paymentMethod === "credit_card" ? "credit_card" : booking.paymentMethod === "cash" ? "cash" : "unspecified");
    setRoomLabel(booking.roomLabel);
    setBookingColor(booking.bookingColor || properties.find((property) => property.id === booking.propertyId)?.highlightColor || bookingColors[0]);
    setCleaningStatus(booking.cleaningStatus || "not_clean");
    setBookingStatus(booking.status === "blocked" ? "blocked" : booking.status === "pending" ? "pending" : "confirmed");
    setNotes(booking.notes);
    setSelectedBooking(null);
    setBookingDialog(true);
  }

  function bookAnotherRoom(booking: Booking) {
    setSelectedBooking(null);
    setSelectedDates([]);
    setSelectionMode(true);
    setActiveTab("calendar");
    toast.info("Choose any dates for the next booking");
  }

  function openPropertyDialog(property?: Property) {
    setEditingPropertyId(property?.id ?? null);
    setPropertyName(property?.name ?? `Listing ${properties.length + 1}`);
    setPropertyAddress(property?.address ?? "");
    setPropertyRate(property ? String(property.nightlyRateCents / 100 || "") : "");
    setPropertyCheckInTime(property?.defaultCheckInTime || "15:00");
    setPropertyCheckOutTime(property?.defaultCheckOutTime || "11:00");
    setPropertyColor(property?.highlightColor ?? "#246bfd");
    setPropertyRoomOptions(property ? roomsFor(property) : defaultRoomOptions);
    setNewRoomOption("");
    setPropertyDialog(true);
  }

  function handleDateTap(date: Date) {
    const value = iso(date);
    setSelectionMode(true);
    setSelectedDates((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value].sort());
  }

  function continueWithSelectedDates() {
    if (selectedDates.length < 1) {
      toast.error("Select at least one night");
      return;
    }
    const consecutive = selectedDates.every((value, index) =>
      value === iso(addDays(parseISO(selectedDates[0]), index)),
    );
    if (!consecutive) {
      toast.error("Select consecutive days without gaps");
      return;
    }
    const endDate = selectedDates.length === 1
      ? addDays(parseISO(selectedDates[0]), 1)
      : parseISO(selectedDates[selectedDates.length - 1]);
    openNewBooking(parseISO(selectedDates[0]), endDate);
  }

  async function saveProperty(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch(editingPropertyId ? `/api/properties/${editingPropertyId}` : "/api/properties", {
      method: editingPropertyId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: propertyName, address: propertyAddress, nightlyRate: Number(propertyRate || 0), roomOptions: propertyRoomOptions, highlightColor: propertyColor, defaultCheckInTime: propertyCheckInTime, defaultCheckOutTime: propertyCheckOutTime }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return toast.error(data.error ?? "Could not save property");
    setProperties((current) => (editingPropertyId
      ? current.map((property) => property.id === data.property.id ? data.property : property)
      : [...current, data.property]
    ));
    if (!editingPropertyId) setSelectedPropertyId(data.property.id);
    if (!editingPropertyId) setActiveTab("calendar");
    setPropertyName("");
    setPropertyAddress("");
    setPropertyRate("");
    setEditingPropertyId(null);
    setPropertyDialog(false);
    toast.success(editingPropertyId ? "Property updated" : "Property added");
  }

  function startPropertyDrag(event: ReactPointerEvent<HTMLButtonElement>, propertyId: number) {
    event.preventDefault();
    dragStartOrderRef.current = propertyOrderRef.current;
    setDraggingPropertyId(propertyId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updatePropertyDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (draggingPropertyId === null) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-property-id]");
    const targetId = Number(target?.dataset.propertyId);
    if (!Number.isInteger(targetId) || targetId === draggingPropertyId) return;
    setProperties((current) => {
      const from = current.findIndex((property) => property.id === draggingPropertyId);
      const to = current.findIndex((property) => property.id === targetId);
      if (from < 0 || to < 0) return current;
      const reordered = [...current];
      const [dragged] = reordered.splice(from, 1);
      reordered.splice(to, 0, dragged);
      propertyOrderRef.current = reordered;
      return reordered;
    });
  }

  async function finishPropertyDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (draggingPropertyId === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingPropertyId(null);
    const reordered = propertyOrderRef.current;
    if (reordered.map((property) => property.id).join(",") === dragStartOrderRef.current.map((property) => property.id).join(",")) return;
    const response = await fetch("/api/properties/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyIds: reordered.map((property) => property.id) }),
    });
    if (!response.ok) {
      setProperties(dragStartOrderRef.current);
      const data = await response.json();
      toast.error(data.error ?? "Could not reorder properties");
    } else {
      toast.success("Property order saved");
    }
  }

  async function addBooking(event: FormEvent) {
    event.preventDefault();
    const targetPropertyId = editingBooking?.propertyId ?? selectedPropertyId;
    if (!targetPropertyId) return;
    setSaving(true);
    const response = await fetch(editingBookingId ? `/api/bookings/${editingBookingId}` : "/api/bookings", {
      method: editingBookingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: targetPropertyId, guestName, guestPhone, guestEmail, guestCount: Number(guestCount), checkIn, checkOut, checkInTime, checkOutTime, nightlyPrice: Number(nightlyPrice || 0), fees: bookingFees.map((fee) => ({ name: fee.name, amount: Number(fee.amount || 0) })), amountPaid: paymentMode === "full" ? total : paymentMode === "unpaid" ? 0 : Number(amountPaid || 0), paymentMethod, status: bookingStatus, notes, roomLabel, bookingColor, cleaningStatus }),
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return toast.error(data.error ?? "Could not save booking");
    setBookings((current) => (editingBookingId ? current.map((item) => item.id === data.booking.id ? data.booking : item) : [...current, data.booking]).sort((a, b) => a.checkIn.localeCompare(b.checkIn)));
    setAllBookings((current) => (editingBookingId ? current.map((item) => item.id === data.booking.id ? data.booking : item) : [...current, data.booking]).sort((a, b) => a.checkIn.localeCompare(b.checkIn)));
    setBookingDialog(false);
    setEditingBookingId(null);
    setSelectedDates([]);
    setSelectionMode(false);
    toast.success(editingBookingId ? "Booking updated" : "Booking created");
  }

  async function deleteProperty() {
    if (!editingPropertyId) return;
    setSaving(true);
    const propertyId = editingPropertyId;
    const response = await fetch(`/api/properties/${propertyId}`, { method: "DELETE" });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return toast.error(data.error ?? "Could not delete property");
    setProperties((current) => current.filter((property) => property.id !== propertyId));
    setBookings((current) => current.filter((booking) => booking.propertyId !== propertyId));
    setAllBookings((current) => current.filter((booking) => booking.propertyId !== propertyId));
    if (selectedPropertyId === propertyId) setSelectedPropertyId(null);
    setEditingPropertyId(null);
    setDeletePropertyDialog(false);
    setPropertyDialog(false);
    setSelectedDates([]);
    setSelectionMode(false);
    setActiveTab("properties");
    toast.success("Property deleted");
  }

  async function deleteBooking() {
    if (!selectedBooking) return;
    setSaving(true);
    const bookingId = selectedBooking.id;
    const response = await fetch(`/api/bookings/${bookingId}`, { method: "DELETE" });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return toast.error(data.error ?? "Could not delete booking");
    setBookings((current) => current.filter((booking) => booking.id !== bookingId));
    setAllBookings((current) => current.filter((booking) => booking.id !== bookingId));
    setDeleteBookingDialog(false);
    setSelectedBooking(null);
    toast.success("Booking permanently deleted");
  }

  async function updateBooking(status: "confirmed" | "pending" | "cancelled" | "checked_out") {
    if (!selectedBooking) return;
    const previousStatus = selectedBooking.status;
    const response = await fetch(`/api/bookings/${selectedBooking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error ?? "Could not update booking");
    setBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setAllBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setSelectedBooking(data.booking);
    toast.success(status === "cancelled" ? "Booking cancelled" : status === "checked_out" ? "Check-out confirmed" : "Booking updated", { action: { label: "Undo", onClick: () => void restoreBookingStatus(data.booking.id, previousStatus) } });
  }

  async function restoreBookingStatus(bookingId: number, status: BookingStatus) {
    const response = await fetch(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error ?? "Could not undo cancellation");
    setBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setAllBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setSelectedBooking((current) => current?.id === data.booking.id ? data.booking : current);
    toast.success("Cancellation undone");
  }

  async function updateCleaningStatus(nextStatus: "clean" | "not_clean") {
    if (!selectedBooking) return;
    const previousStatus = selectedBooking.cleaningStatus || "not_clean";
    const bookingId = selectedBooking.id;
    const response = await fetch(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleaningStatus: nextStatus }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error ?? "Could not update cleaning status");
    setBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setAllBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setSelectedBooking(data.booking);
    toast.success(nextStatus === "clean" ? "Marked clean" : "Marked not clean", { action: { label: "Undo", onClick: () => void restoreCleaningStatus(bookingId, previousStatus) } });
  }

  async function restoreCleaningStatus(bookingId: number, cleaningStatus: "clean" | "not_clean") {
    const response = await fetch(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleaningStatus }),
    });
    const data = await response.json();
    if (!response.ok) return toast.error(data.error ?? "Could not undo cleaning change");
    setBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setAllBookings((current) => current.map((item) => item.id === data.booking.id ? data.booking : item));
    setSelectedBooking((current) => current?.id === data.booking.id ? data.booking : current);
    toast.success("Cleaning change undone");
  }

  async function loadBackupList() {
    const response = await fetch("/api/backups");
    const data = await response.json();
    if (!response.ok) {
      toast.error(data.error ?? "Could not load backups");
      return [] as BackupSnapshot[];
    }
    setBackups(data.backups);
    return data.backups as BackupSnapshot[];
  }

  async function openAutomaticBackups() {
    setBackupsDialog(true);
    await loadBackupList();
  }

  async function openLatestBackup() {
    const latest = (await loadBackupList())[0];
    if (!latest) return toast.info("There is no change to undo yet");
    setBackupToRestore(latest);
  }

  async function restoreAutomaticBackup() {
    if (!backupToRestore) return;
    setSaving(true);
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupId: backupToRestore.id }),
      });
      const data = await response.json().catch(() => ({ error: "Could not restore backup" }));
      if (!response.ok) return toast.error(data.error ?? "Could not restore backup");
      const wasRedo = backupToRestore.reason === "Before restoring a backup";
      setBackupToRestore(null);
      setBackupsDialog(false);
      setSelectedPropertyId(null);
      setActiveTab("properties");
      await Promise.all([loadProperties(), loadAllBookings()]);
      await loadBackupList();
      toast.success(wasRedo ? "Change redone" : "Last change undone");
    } catch {
      toast.error("Could not restore backup. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function chooseBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("This backup file is too large");
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (data.format !== "stay-calendar-backup" || !Array.isArray(data.properties) || !Array.isArray(data.bookings)) throw new Error("Choose a Roomie backup JSON file");
      setImportBackup({ fileName: file.name, data, properties: data.properties.length, bookings: data.bookings.length });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read this backup file");
    }
  }

  async function restoreExportedBackup() {
    if (!importBackup) return;
    setSaving(true);
    try {
      const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(importBackup.data) });
      const data = await response.json().catch(() => ({ error: "Could not restore this backup" }));
      if (!response.ok) return toast.error(data.error ?? "Could not restore this backup");
      setImportBackup(null);
      setSelectedPropertyId(null);
      setActiveTab("properties");
      await Promise.all([loadProperties(), loadAllBookings()]);
      await loadBackupList();
      toast.success(`Restored ${data.properties} listings and ${data.bookings} bookings`);
    } catch {
      toast.error("Could not restore this backup. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function exportBackup() {
    if (exporting) return;
    setExporting(true);
    try {
      const exportedAt = new Date().toISOString();
      const blob = new Blob([JSON.stringify({ format: "stay-calendar-backup", version: 1, exportedAt, exportedBy: email, properties, bookings: allBookings }, null, 2)], { type: "application/json" });
      const fileName = `roomie-backup-${exportedAt.slice(0, 10)}.json`;
      const file = new File([blob], fileName, { type: "application/json" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: "Roomie backup" });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("Backup downloaded");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Could not create backup");
    } finally {
      setExporting(false);
    }
  }

  const nights = checkIn && checkOut ? Math.max(0, differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn))) : 0;
  const feesTotal = bookingFees.reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
  const total = nights * Number(nightlyPrice || 0) + feesTotal;
  const effectiveAmountPaid = paymentMode === "full" ? total : paymentMode === "unpaid" ? 0 : Number(amountPaid || 0);
  const balance = Math.max(0, total - effectiveAmountPaid);
  const formBookings = formProperty ? allBookings.filter((booking) => booking.propertyId === formProperty.id) : [];
  const unavailableRoomOptions = unavailableRoomsForRange(formProperty, formBookings, checkIn, checkOut, editingBookingId);
  const directlyBookedRoomOptions = new Set(formBookings
    .filter((booking) => booking.id !== editingBookingId && booking.status !== "cancelled" && booking.checkIn < checkOut && booking.checkOut > checkIn)
    .map((booking) => canonicalRoom(booking.roomLabel)));
  const pageTitle = activeTab === "today" ? "Today" : activeTab === "properties" ? "Listings" : activeTab === "more" ? morePage === "earnings" ? "Earnings" : morePage === "backup" ? "Backup" : "More" : selectedProperty?.name ?? "Calendar";
  const today = iso(new Date());
  const todayCheckIns = allBookings.filter((booking) => !["cancelled", "checked_out"].includes(booking.status) && booking.checkIn === today);
  const todayCheckOuts = allBookings.filter((booking) => !["cancelled", "checked_out"].includes(booking.status) && booking.checkOut === today);
  const todayStays = allBookings.filter((booking) => !["cancelled", "checked_out"].includes(booking.status) && booking.checkIn < today && booking.checkOut > today);
  const upcomingBookings = allBookings
    .filter((booking) => !["cancelled", "checked_out", "blocked"].includes(booking.status) && booking.checkIn > today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id - b.id);
  const normalizedListingSearch = listingSearch.trim().toLocaleLowerCase();
  const filteredProperties = normalizedListingSearch
    ? properties.filter((property) => [property.name, property.address, ...roomsFor(property)]
      .some((value) => value.toLocaleLowerCase().includes(normalizedListingSearch)))
    : properties;
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const searchResults = normalizedSearch ? allBookings.filter((booking) => {
    const property = properties.find((item) => item.id === booking.propertyId);
    return [booking.guestName, booking.guestPhone, booking.guestEmail, booking.roomLabel, booking.checkIn, booking.checkOut, property?.name, property?.address]
      .some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearch));
  }) : [];
  const outstandingBookings = allBookings.filter((booking) => booking.status !== "cancelled" && booking.amountPaidCents < booking.totalPriceCents);
  const paymentResults = outstandingBookings.filter((booking) => paymentFilter === "all" || paymentState(booking).toLocaleLowerCase() === paymentFilter);
  const outstandingTotal = outstandingBookings.reduce((sum, booking) => sum + Math.max(0, booking.totalPriceCents - booking.amountPaidCents), 0);
  const earningsMonths = Array.from({ length: earningsRange }, (_, index) => subMonths(startOfMonth(new Date()), earningsRange - index - 1));
  const earningsMonthKeys = new Set(earningsMonths.map((date) => format(date, "yyyy-MM")));
  const earningsBookings = allBookings.filter((booking) => !["cancelled", "blocked"].includes(booking.status)
    && earningsMonthKeys.has(booking.checkIn.slice(0, 7))
    && (earningsProperty === "all" || booking.propertyId === Number(earningsProperty)));
  const earningsBookedTotal = earningsBookings.reduce((sum, booking) => sum + booking.totalPriceCents, 0);
  const earningsCollectedTotal = earningsBookings.reduce((sum, booking) => sum + booking.amountPaidCents, 0);
  const earningsCashTotal = earningsBookings.filter((booking) => booking.paymentMethod === "cash").reduce((sum, booking) => sum + booking.amountPaidCents, 0);
  const earningsCardTotal = earningsBookings.filter((booking) => booking.paymentMethod === "credit_card").reduce((sum, booking) => sum + booking.amountPaidCents, 0);
  const earningsUnspecifiedTotal = Math.max(0, earningsCollectedTotal - earningsCashTotal - earningsCardTotal);
  const earningsOutstandingTotal = Math.max(0, earningsBookedTotal - earningsCollectedTotal);
  const earningsByMonth = earningsMonths.map((date) => {
    const key = format(date, "yyyy-MM");
    const rows = earningsBookings.filter((booking) => booking.checkIn.startsWith(key));
    return { key, label: format(date, earningsRange > 6 ? "MMM yy" : "MMM"), total: rows.reduce((sum, booking) => sum + booking.amountPaidCents, 0) };
  });
  const earningsChartMax = Math.max(1, ...earningsByMonth.map((item) => item.total));

  function openCalendarTab() {
    setSelectedPropertyId(null);
    setSelectedDates([]);
    setSelectionMode(false);
    setActiveTab("calendar");
  }

  function propertyForBooking(booking: Booking) {
    return properties.find((property) => property.id === booking.propertyId);
  }

  function paymentState(booking: Booking) {
    if (booking.amountPaidCents >= booking.totalPriceCents) return "Paid";
    if (booking.amountPaidCents > 0) return "Partial";
    return "Unpaid";
  }

  function bookingListButton(booking: Booking, timeType?: "checkIn" | "checkOut") {
    const property = propertyForBooking(booking);
    return <button key={booking.id} className="booking-list-item" onClick={() => { setPaymentDialog(false); setSelectedBooking(booking); }}><span className="booking-list-date"><strong>{timeType ? displayTime(timeType === "checkIn" ? booking.checkInTime : booking.checkOutTime) : format(parseISO(booking.checkIn), "MMM d")}</strong><small>{timeType === "checkIn" ? "Check-in" : timeType === "checkOut" ? "Check-out" : format(parseISO(booking.checkOut), "MMM d")}</small></span><span className="booking-list-copy"><strong>{booking.guestName}</strong><small>{property?.name} · {booking.roomLabel}</small></span><span className={`payment-mini ${paymentState(booking).toLocaleLowerCase()}`}>{paymentState(booking)}</span><ChevronRight /></button>;
  }

  return (
    <main className="app-shell" style={{ "--property-color": selectedProperty?.highlightColor ?? "#246bfd" } as CSSProperties}>
      <Toaster position="top-center" />
      <header className="topbar">
        <div>
          <p className="eyebrow">Roomie</p>
          <h1>{pageTitle}</h1>
          {activeTab === "calendar" && selectedProperty?.address && <p className="property-address"><MapPin />{selectedProperty.address}</p>}
        </div>
        <button className="avatar" aria-label={`${displayName} account`} onClick={() => setAccountDialog(true)}>{displayName.slice(0, 1).toUpperCase()}</button>
      </header>

      {activeTab === "today" ? (
        <section className="today-screen">
          <div className="stay-view-toggle" role="tablist" aria-label="Booking schedule">
            <button type="button" role="tab" aria-selected={todayView === "today"} className={todayView === "today" ? "active" : ""} onClick={() => setTodayView("today")}>Today</button>
            <button type="button" role="tab" aria-selected={todayView === "upcoming"} className={todayView === "upcoming" ? "active" : ""} onClick={() => setTodayView("upcoming")}>Upcoming</button>
          </div>
          {todayView === "today" ? <>
            <div className="today-summary"><div><strong>{todayCheckIns.length}</strong><span>Check-ins</span></div><div><strong>{todayCheckOuts.length}</strong><span>Check-outs</span></div><div><strong>{todayStays.length}</strong><span>Staying</span></div></div>
            <section className="today-group"><h2><LogIn /> Check-ins</h2>{todayCheckIns.length ? <div className="booking-list">{todayCheckIns.map((booking) => bookingListButton(booking, "checkIn"))}</div> : <p className="nothing-today">No check-ins today</p>}</section>
            <section className="today-group"><h2><LogOut /> Check-outs</h2>{todayCheckOuts.length ? <div className="booking-list">{todayCheckOuts.map((booking) => bookingListButton(booking, "checkOut"))}</div> : <p className="nothing-today">No check-outs today</p>}</section>
            <section className="today-group"><h2><Users /> Currently staying</h2>{todayStays.length ? <div className="booking-list">{todayStays.map((booking) => bookingListButton(booking))}</div> : <p className="nothing-today">No current guests</p>}</section>
          </> : <section className="upcoming-section">
            <h2>You have {upcomingBookings.length} upcoming {upcomingBookings.length === 1 ? "booking" : "bookings"}</h2>
            {upcomingBookings.length ? <div className="upcoming-list">{upcomingBookings.map((booking) => {
              const listing = propertyForBooking(booking);
              return <button type="button" key={booking.id} className="upcoming-card" onClick={() => setSelectedBooking(booking)}>
                <span className="upcoming-icon" style={{ "--booking-color": booking.bookingColor || listing?.highlightColor || "#607b9c" } as CSSProperties}><Building2 /></span>
                <span className="upcoming-copy"><strong>{booking.guestName}</strong><small>{listing?.name} · {booking.roomLabel}</small><span>{format(parseISO(booking.checkIn), "MMM d")} – {format(parseISO(booking.checkOut), "MMM d")}</span></span>
                <ChevronRight />
              </button>;
            })}</div> : <p className="nothing-today">No upcoming bookings</p>}
          </section>}
        </section>
      ) : activeTab === "properties" ? (
        <section className="properties-screen">
          <div className="properties-heading">
            <div><h2>Select a listing</h2><p>Each listing has its own calendar.</p></div>
          </div>

          <div className="listing-search">
            <Search />
            <Input value={listingSearch} onChange={(event) => setListingSearch(event.target.value)} placeholder="Search listings" aria-label="Search listings" />
            {listingSearch && <button type="button" onClick={() => setListingSearch("")} aria-label="Clear listing search"><X /></button>}
          </div>

          {properties.length > 0 ? (
            <div className="property-grid">
              {filteredProperties.map((property) => (
                <div key={property.id} data-property-id={property.id} className={`property-card-wrap ${draggingPropertyId === property.id ? "dragging" : ""}`}>
                  <button className="property-card" style={{ "--listing-color": property.highlightColor || "#607b9c" } as CSSProperties} onClick={() => openPropertyDialog(property)}>
                    <span className="property-card-icon"><Building2 /></span>
                    <span className="property-card-copy"><strong>{property.name}</strong><small className="card-address">{property.address || "Address not set"}</small><span className="property-card-meta"><small>{roomsFor(property).length} rental options</small><small>{property.nightlyRateCents > 0 ? `${money(property.nightlyRateCents)} per night` : "Price not set"}</small></span></span>
                    <ChevronRight />
                  </button>
                  {!normalizedListingSearch && <button type="button" className="property-drag-handle" aria-label={`Drag to reorder ${property.name}`} onPointerDown={(event) => startPropertyDrag(event, property.id)} onPointerMove={updatePropertyDrag} onPointerUp={(event) => void finishPropertyDrag(event)} onPointerCancel={(event) => void finishPropertyDrag(event)}><GripVertical /></button>}
                </div>
              ))}
              {filteredProperties.length === 0 && <p className="listing-search-empty">No listings found</p>}
            </div>
          ) : !loading && (
            <section className="empty-state">
              <div className="empty-icon"><Building2 /></div>
              <h2>Add your first listing</h2>
              <p>It will appear here as its own labeled box.</p>
              <Button onClick={() => openPropertyDialog()}><CirclePlus /> Add Listing 1</Button>
            </section>
          )}
          {properties.length > 0 && <button className="property-add-button" onClick={() => openPropertyDialog()} aria-label="Add listing" title="Add listing"><Plus /></button>}
        </section>
      ) : activeTab === "more" ? (
        morePage === "earnings" ? (
        <section className="earnings-screen">
          <button type="button" className="subpage-back" onClick={() => setMorePage("menu")}><ChevronLeft /> More</button>
          <Select value={earningsProperty} onValueChange={setEarningsProperty}><SelectTrigger className="earnings-listing-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All listings ({properties.length})</SelectItem>{properties.map((property) => <SelectItem key={property.id} value={String(property.id)}>{property.name}</SelectItem>)}</SelectContent></Select>
          <div className="earnings-range" role="group" aria-label="Earnings period">{([1, 3, 6, 12] as const).map((value) => <button type="button" key={value} className={earningsRange === value ? "active" : ""} onClick={() => setEarningsRange(value)}>{value === 1 ? "This month" : `${value} months`}</button>)}</div>
          <section className="earnings-hero"><small>BOOKED TOTAL</small><strong>{money(earningsBookedTotal)}</strong><span>{earningsBookings.length} {earningsBookings.length === 1 ? "booking" : "bookings"}</span></section>
          <div className="earnings-stats">
            <section><small>COLLECTED</small><strong>{money(earningsCollectedTotal)}</strong><span>actual payments</span></section>
            <section><small>OUTSTANDING</small><strong>{money(earningsOutstandingTotal)}</strong><span>still due</span></section>
            <section><small>CASH</small><strong>{money(earningsCashTotal)}</strong><span>collected</span></section>
            <section><small>CREDIT CARD</small><strong>{money(earningsCardTotal)}</strong><span>collected</span></section>
          </div>
          {earningsUnspecifiedTotal > 0 && <p className="earnings-note"><strong>{money(earningsUnspecifiedTotal)} has no payment method yet.</strong> Edit older bookings to label them as Cash or Credit card.</p>}
          <section className="earnings-chart"><div><strong>Collected per month</strong><span>By check-in month</span></div><div className="earnings-bars">{earningsByMonth.map((item) => <span key={item.key} className="earnings-bar-item"><span className="earnings-bar-value">{money(item.total)}</span><span className="earnings-bar-track"><i style={{ height: `${Math.max(item.total > 0 ? 8 : 0, item.total / earningsChartMax * 100)}%` }} /></span><small>{item.label}</small></span>)}</div></section>
        </section>
      ) : morePage === "backup" ? (
        <section className="more-screen">
          <button type="button" className="subpage-back" onClick={() => setMorePage("menu")}><ChevronLeft /> More</button>
          <div className="more-list">
            <button onClick={() => void openAutomaticBackups()}><span className="more-icon"><History /></span><span><strong>Automatic backups</strong><small>Restore one of the last 25 saved versions</small></span><ChevronRight /></button>
            <button disabled={exporting} onClick={() => void exportBackup()}><span className="more-icon"><Download /></span><span><strong>{exporting ? "Creating backup…" : "Export backup"}</strong><small>Save all listings and bookings to Files</small></span><ChevronRight /></button>
            <button onClick={() => importInputRef.current?.click()}><span className="more-icon"><RotateCcw /></span><span><strong>Restore backup file</strong><small>Restore a previously exported JSON backup</small></span><ChevronRight /></button>
            <input ref={importInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={(event) => void chooseBackupFile(event)} />
          </div>
        </section>
      ) : (
        <section className="more-screen">
          <div className="more-list">
            <button onClick={() => { setSearchQuery(""); setSearchDialog(true); }}><span className="more-icon"><Search /></span><span><strong>Search bookings</strong><small>Guest  listing  room  phone or date</small></span><ChevronRight /></button>
            <button onClick={() => { setPaymentFilter("all"); setPaymentDialog(true); }}><span className="more-icon"><WalletCards /></span><span><strong>Payment tracking</strong><small>{outstandingBookings.length} balances due · {money(outstandingTotal)}</small></span><ChevronRight /></button>
            <button onClick={() => setMorePage("earnings")}><span className="more-icon"><CalendarDays /></span><span><strong>Earnings</strong><small>Monthly totals  Cash and Credit card</small></span><ChevronRight /></button>
            <button onClick={() => void openLatestBackup()}><span className="more-icon"><Undo2 /></span><span><strong>{backups[0]?.reason === "Before restoring a backup" ? "Redo last undo" : "Undo last change"}</strong><small>{backups.length ? backups[0].reason : "Nothing to undo yet"}</small></span><ChevronRight /></button>
            <button onClick={() => setMorePage("backup")}><span className="more-icon"><History /></span><span><strong>Backup</strong><small>Automatic  export and restore</small></span><ChevronRight /></button>
          </div>
          <div className="install-note"><strong>Installed on iPhone</strong><p>Open this app in Safari then use Share and Add to Home Screen.</p></div>
        </section>
      )
      ) : selectedProperty ? <>
        <section className="calendar-toolbar">
          <button onClick={() => { setSelectedPropertyId(null); setSelectedDates([]); setSelectionMode(false); }}><ChevronLeft /> All calendars</button>
          <button onClick={() => openPropertyDialog(selectedProperty)}><Pencil /> Edit listing</button>
        </section>

        <section className="calendar-card">
        <div className="calendar-visibility-toggle">
          <span><strong>Hide checked-out</strong><small>Show upcoming and current stays only</small></span>
          <Switch checked={hideCheckedOut} onCheckedChange={(checked) => { setHideCheckedOut(checked); window.localStorage.setItem("roomie-hide-checked-out", String(checked)); }} aria-label="Hide checked-out bookings" />
        </div>
        <div className="month-header">
          <Button variant="ghost" size="icon" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft /></Button>
          <button onClick={() => setMonth(startOfMonth(new Date()))} className="month-title">
            <strong>{format(month, "MMMM yyyy")}</strong><span>Tap to return to today</span>
          </button>
          <Button variant="ghost" size="icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight /></Button>
        </div>
        <div className="weekday-row">{weekdayNames.map((day) => <div key={day}>{day}</div>)}</div>
        <div className="calendar-grid">
          {calendarDays.map((date) => {
            const bookingsOnDay = bookingsForDate(date);
            const dateValue = iso(date);
            const nextDateValue = iso(addDays(date, 1));
            const roomCount = roomsFor(selectedProperty).length;
            const canStartNight = unavailableRoomsForRange(selectedProperty, activeBookings, dateValue, nextDateValue).size < roomCount;
            const dateSelectable = Boolean(selectedPropertyId) && canStartNight;
            const fullyBooked = !dateSelectable;
            const displayBookings: Array<Booking | null> = [null, null, null, null];
            bookingsOnDay.forEach((booking) => {
              const lane = bookingLaneById.get(booking.id);
              if (lane !== undefined) displayBookings[lane] = booking;
            });
            const isSelected = selectedDates.includes(dateValue);
            return (
              <div key={dateValue} className={`day-cell ${!isSameMonth(date, month) ? "outside" : ""} ${bookingsOnDay.length ? "occupied" : ""} ${fullyBooked ? "fully-booked" : ""} ${isSelected ? "selected-day" : ""}`}>
                <button className="day-select-target" onClick={() => handleDateTap(date)} disabled={!dateSelectable} aria-label={fullyBooked ? `${format(date, "MMMM d")} cannot form a bookable stay` : `${isSelected ? "Remove" : "Select"} ${format(date, "MMMM d")}`}>
                  <span className="day-number">{format(date, "d")}</span>
                  {!bookingsOnDay.length && selectedProperty && isSameMonth(date, month) ? <span className="day-price">{money(selectedProperty.nightlyRateCents)}</span> : null}
                </button>
                {bookingsOnDay.length ? <span className="booking-chips">{displayBookings.map((booking, slot) => booking ? <button type="button" key={`${booking.id}-${slot}`} className={`booking-chip ${booking.status}${dateValue === booking.checkOut ? " checkout-day" : ""}`} style={{ "--booking-color": booking.bookingColor || selectedProperty.highlightColor } as CSSProperties} onClick={() => setSelectedBooking(booking)} aria-label={`Open ${booking.roomLabel} booking for ${booking.guestName}${dateValue === booking.checkOut ? ", checkout day" : ""}`}><strong>{booking.roomLabel}</strong><small>{booking.guestName}</small></button> : <span className="booking-chip-placeholder" key={`empty-${slot}`} />)}</span> : null}
              </div>
            );
          })}
        </div>
        </section>

        {selectedDates.length > 0 ? (
          <div className="bottom-selection-bar" role="status">
            <button className="bottom-reset" onClick={() => { setSelectedDates([]); setSelectionMode(false); }}>Reset</button>
            <div><strong>{selectedDates.length} {selectedDates.length === 1 ? "day" : "days"}</strong><span>{selectedDates.length === 1 ? 1 : selectedDates.length - 1} {selectedDates.length <= 2 ? "night" : "nights"}</span></div>
            <button className="bottom-continue" onClick={continueWithSelectedDates}>Continue</button>
          </div>
        ) : (
          <button className="floating-button" onClick={() => { setSelectionMode(true); toast.info("Now tap every day of the stay"); }}><Plus /> Select days</button>
        )}
      </> : (
        <section className="all-calendars-screen">
          <div className="all-calendars-heading"><h2>All calendars</h2><p>Choose a listing to open its calendar.</p></div>
          {properties.length ? <div className="calendar-list">{properties.map((property) => {
            const activeCount = allBookings.filter((booking) => booking.propertyId === property.id && !["cancelled", "checked_out"].includes(booking.status) && booking.checkOut >= today).length;
            return <button type="button" key={property.id} onClick={() => { setSelectedPropertyId(property.id); setSelectedDates([]); setSelectionMode(false); }}>
              <span className="calendar-list-icon" style={{ "--listing-color": property.highlightColor || "#607b9c" } as CSSProperties}><CalendarDays /></span>
              <span><strong>{property.name}</strong><small>{property.address || "Address not set"}</small><em>{activeCount} active {activeCount === 1 ? "booking" : "bookings"}</em></span>
              <ChevronRight />
            </button>;
          })}</div> : <section className="empty-state"><div className="empty-icon"><CalendarDays /></div><h2>No calendars yet</h2><p>Add a listing first  then its calendar will appear here.</p><Button onClick={() => { setActiveTab("properties"); openPropertyDialog(); }}><CirclePlus /> Add listing</Button></section>}
        </section>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className={activeTab === "today" ? "active" : ""} onClick={() => { setActiveTab("today"); setSelectedDates([]); setSelectionMode(false); }}><CalendarCheck /><span>Today</span></button>
        <button className={activeTab === "calendar" ? "active" : ""} onClick={openCalendarTab}><CalendarDays /><span>Calendar</span></button>
        <button className={activeTab === "properties" ? "active" : ""} onClick={() => { setActiveTab("properties"); setSelectedDates([]); setSelectionMode(false); }}><Building2 /><span>Listings</span></button>
        <button className={activeTab === "more" ? "active" : ""} onClick={() => { setActiveTab("more"); setMorePage("menu"); setSelectedDates([]); setSelectionMode(false); }}><MoreHorizontal /><span>More</span></button>
      </nav>

      <Dialog open={propertyDialog} onOpenChange={setPropertyDialog}>
        <DialogContent className="mobile-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader><DialogTitle>{editingPropertyId ? "Edit listing" : "Add listing"}</DialogTitle><DialogDescription>{editingPropertyId ? "Update this listing’s details and default price." : "Create a separate calendar for a room or unit."}</DialogDescription></DialogHeader>
          <form onSubmit={saveProperty} className="form-stack">
            <div><Label htmlFor="property-name">Listing name</Label><Input id="property-name" value={propertyName} onChange={(e) => setPropertyName(e.target.value)} placeholder={`Listing ${properties.length + 1}`} /></div>
            <div><Label htmlFor="property-address">Address</Label><Input id="property-address" value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} placeholder="123 Main Street" /></div>
            <div><Label htmlFor="property-rate">Default nightly price</Label><div className="money-input"><span>$</span><Input id="property-rate" type="number" min="0" step="0.01" value={propertyRate} onChange={(e) => setPropertyRate(e.target.value)} placeholder="95" /></div></div>
            <div className="two-columns"><div><Label htmlFor="property-check-in-time">Default check-in</Label><Input id="property-check-in-time" type="time" value={propertyCheckInTime} onChange={(e) => setPropertyCheckInTime(e.target.value)} required /></div><div><Label htmlFor="property-check-out-time">Default check-out</Label><Input id="property-check-out-time" type="time" value={propertyCheckOutTime} onChange={(e) => setPropertyCheckOutTime(e.target.value)} required /></div></div>
            <div><Label htmlFor="property-color">Calendar highlight color</Label><div className="color-picker"><input id="property-color" type="color" value={propertyColor} onChange={(e) => setPropertyColor(e.target.value)} /><span>{propertyColor.toUpperCase()}</span></div></div>
            <div><Label>Rental options</Label><div className="option-list">{propertyRoomOptions.map((option) => <span key={option}>{option}<button type="button" aria-label={`Remove ${option}`} onClick={() => setPropertyRoomOptions((current) => current.filter((item) => item !== option))}><X /></button></span>)}</div><div className="add-option"><Input value={newRoomOption} onChange={(e) => setNewRoomOption(e.target.value)} placeholder="Add another room option" /><Button type="button" variant="outline" onClick={() => { const option = newRoomOption.trim(); if (option && !propertyRoomOptions.some((item) => item.toLocaleLowerCase() === option.toLocaleLowerCase())) setPropertyRoomOptions((current) => [...current, option]); setNewRoomOption(""); }}>Add</Button></div></div>
            <Button type="submit" size="lg" disabled={saving}>{saving ? "Saving…" : editingPropertyId ? "Save changes" : "Add listing"}</Button>
            {editingPropertyId && <Button type="button" variant="outline" className="danger-button delete-property-button" onClick={() => setDeletePropertyDialog(true)}>Delete listing</Button>}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deletePropertyDialog} onOpenChange={setDeletePropertyDialog}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {propertyName}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the listing and every booking saved inside it. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep listing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={saving} onClick={deleteProperty}>{saving ? "Deleting…" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={accountDialog} onOpenChange={setAccountDialog}>
        <DialogContent className="mobile-dialog account-dialog">
          <DialogHeader><DialogTitle>Your account</DialogTitle><DialogDescription>Your Roomie access</DialogDescription></DialogHeader>
          <div className="account-identity">
            <span className="account-avatar">{displayName.slice(0, 1).toUpperCase()}</span>
            <span><strong>{displayName}</strong><small>{email}</small></span>
          </div>
          <div className="account-details">
            <div><span className="account-detail-icon"><UserRound /></span><span><small>Role</small><strong>Owner</strong></span></div>
            <div><span className="account-detail-icon"><LockKeyhole /></span><span><small>App access</small><strong>Private</strong></span></div>
            <div><span className="account-detail-icon"><ShieldCheck /></span><span><small>Who can open it</small><strong>Only invited people</strong></span></div>
            <div><span className="account-detail-icon"><Mail /></span><span><small>Signed in with</small><strong>{email}</strong></span></div>
          </div>
          <p className="account-note">Your boss is not connected yet. You can invite her when the app is ready.</p>
          <Button asChild variant="outline" className="account-signout"><a href={signOutPath}><LogOut /> Sign out</a></Button>
        </DialogContent>
      </Dialog>

      <Dialog open={backupsDialog} onOpenChange={setBackupsDialog}>
        <DialogContent className="mobile-dialog">
          <DialogHeader><DialogTitle>Automatic backups</DialogTitle><DialogDescription>A backup is saved before every change. The newest 25 are kept.</DialogDescription></DialogHeader>
          {backups.length ? <div className="day-booking-list">{backups.map((backup) => <button key={backup.id} onClick={() => setBackupToRestore(backup)}><span><strong>{backup.reason}</strong><small>{new Date(`${backup.createdAt.replace(" ", "T")}Z`).toLocaleString()}</small></span><ChevronRight /></button>)}</div> : <p className="search-empty">No automatic backups yet. The first one will be created before your next change.</p>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!backupToRestore} onOpenChange={(open) => !open && setBackupToRestore(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{backupToRestore?.reason === "Before restoring a backup" ? "Redo the last undo?" : "Undo the last change?"}</AlertDialogTitle>
            <AlertDialogDescription>Your listings and bookings will return to the saved state from {backupToRestore ? new Date(`${backupToRestore.createdAt.replace(" ", "T")}Z`).toLocaleString() : "this time"}. You can reverse this again afterward.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep current data</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={restoreAutomaticBackup}>{saving ? "Restoring…" : backupToRestore?.reason === "Before restoring a backup" ? "Redo" : "Undo"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!importBackup} onOpenChange={(open) => !open && setImportBackup(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup file?</AlertDialogTitle>
            <AlertDialogDescription>{importBackup?.fileName} contains {importBackup?.properties ?? 0} listings and {importBackup?.bookings ?? 0} bookings. It will replace the current data. Roomie will automatically save the current data first so this restore can be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep current data</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={restoreExportedBackup}>{saving ? "Restoring…" : "Restore backup"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={bookingDialog} onOpenChange={setBookingDialog}>
        <DialogContent className="mobile-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader><DialogTitle>{editingBookingId ? "Edit booking" : "New booking"}</DialogTitle><DialogDescription>{formProperty?.name}</DialogDescription></DialogHeader>
          <form onSubmit={addBooking} className="form-stack">
            {formProperty?.address && <div className="booking-address"><MapPin /><span><small>Listing address</small><strong>{formProperty.address}</strong></span></div>}
            <div><Label htmlFor="guest-name">Guest name</Label><Input id="guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder={bookingStatus === "blocked" ? "Optional" : "Full name"} /></div>
            <div className="two-columns"><div><Label htmlFor="guest-phone">Phone</Label><Input id="guest-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="Optional" /></div><div><Label htmlFor="guest-email">Email</Label><Input id="guest-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="Optional" /></div></div>
            <div className="two-columns"><div><Label htmlFor="guest-count">Number of guests</Label><Input id="guest-count" type="number" min="1" step="1" value={guestCount} onChange={(e) => setGuestCount(e.target.value)} /></div><div><Label>Rental option</Label><Select value={roomLabel} onValueChange={setRoomLabel}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{roomsFor(formProperty).map((option) => { const unavailable = unavailableRoomOptions.has(option); const directlyBooked = directlyBookedRoomOptions.has(canonicalRoom(option)); return <SelectItem key={option} value={option} disabled={unavailable}>{option}{unavailable ? directlyBooked ? " · Booked" : " · Unavailable" : ""}</SelectItem>; })}</SelectContent></Select></div></div>
            <div><Label>Booking color</Label><div className="booking-color-picker">{bookingColors.map((color) => <button key={color} type="button" className={bookingColor.toLocaleLowerCase() === color.toLocaleLowerCase() ? "selected" : ""} style={{ backgroundColor: color }} onClick={() => setBookingColor(color)} aria-label={`Use ${color}`} />)}<label className="custom-booking-color" title="Custom color"><input type="color" value={bookingColor} onChange={(event) => setBookingColor(event.target.value)} /><span>Custom</span></label></div></div>
            <p className="availability-help">Unavailable rooms are disabled for these dates.</p>
            {editingBookingId ? <div className="two-columns"><div><Label htmlFor="edit-check-in">Check-in</Label><Input id="edit-check-in" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div><div><Label htmlFor="edit-check-out">Check-out</Label><Input id="edit-check-out" type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} /></div></div> : <div className="selected-dates">
              <div><span>Check-in</span><strong>{format(parseISO(checkIn), "MMM d")}</strong></div>
              <div className="date-line" />
              <div><span>Check-out</span><strong>{format(parseISO(checkOut), "MMM d")}</strong></div>
              <button type="button" onClick={() => { setBookingDialog(false); toast.info("Tap days to add or remove them"); }}>Change</button>
            </div>}
            <div className="two-columns"><div><Label htmlFor="booking-check-in-time">Check-in time</Label><Input id="booking-check-in-time" type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} required /></div><div><Label htmlFor="booking-check-out-time">Check-out time</Label><Input id="booking-check-out-time" type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} required /></div></div>
            <div><Label htmlFor="nightly-price">Nightly price</Label><div className="money-input"><span>$</span><Input id="nightly-price" type="number" min="0" step="0.01" value={nightlyPrice} onChange={(e) => setNightlyPrice(e.target.value)} /></div></div>
            <div className="booking-fees">
              <div className="booking-fees-heading"><span><strong>Fees</strong><small>Add charges for this booking only</small></span><Button type="button" variant="outline" size="sm" onClick={() => setBookingFees((current) => [...current, { id: crypto.randomUUID(), name: "", amount: "" }])}><Plus /> Add fee</Button></div>
              {bookingFees.map((fee) => <div className="booking-fee-row" key={fee.id}>
                <Input aria-label="Fee name" value={fee.name} onChange={(event) => setBookingFees((current) => current.map((item) => item.id === fee.id ? { ...item, name: event.target.value } : item))} placeholder="e.g. Cleaning fee" />
                <div className="money-input"><span>$</span><Input aria-label="Fee amount" type="number" min="0" step="0.01" value={fee.amount} onChange={(event) => setBookingFees((current) => current.map((item) => item.id === fee.id ? { ...item, amount: event.target.value } : item))} placeholder="0" /></div>
                <button type="button" className="remove-fee" onClick={() => setBookingFees((current) => current.filter((item) => item.id !== fee.id))} aria-label="Remove fee"><Trash2 /></button>
              </div>)}
              {bookingFees.length > 0 && <div className="fees-subtotal"><span>Fees total</span><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(feesTotal)}</strong></div>}
            </div>
            <div><Label>Payment</Label><div className="payment-mode" role="group" aria-label="Payment status">
              <button type="button" className={paymentMode === "full" ? "active" : ""} onClick={() => setPaymentMode("full")}>Paid in full</button>
              <button type="button" className={paymentMode === "partial" ? "active" : ""} onClick={() => setPaymentMode("partial")}>Partially paid</button>
              <button type="button" className={paymentMode === "unpaid" ? "active" : ""} onClick={() => setPaymentMode("unpaid")}>Unpaid</button>
            </div></div>
            {paymentMode === "partial" && <div><Label htmlFor="amount-paid">Amount paid</Label><div className="money-input"><span>$</span><Input id="amount-paid" type="number" min="0" max={total} step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0" /></div></div>}
            <div><Label>Payment method</Label><div className="payment-method" role="group" aria-label="Payment method">
              <button type="button" className={paymentMethod === "cash" ? "active" : ""} onClick={() => setPaymentMethod("cash")}>Cash</button>
              <button type="button" className={paymentMethod === "credit_card" ? "active" : ""} onClick={() => setPaymentMethod("credit_card")}>Credit card</button>
              <button type="button" className={paymentMethod === "unspecified" ? "active" : ""} onClick={() => setPaymentMethod("unspecified")}>Not set</button>
            </div></div>
            <div><Label>Status</Label><Select value={bookingStatus} onValueChange={(value) => setBookingStatus(value as typeof bookingStatus)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent></Select></div>
            <div><Label>Cleaning</Label><Select value={cleaningStatus} onValueChange={(value) => setCleaningStatus(value as "clean" | "not_clean")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_clean">Not clean</SelectItem><SelectItem value="clean">Clean</SelectItem></SelectContent></Select></div>
            <div><Label htmlFor="notes">Notes</Label><Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></div>
            <div className="payment-summary"><span><small>Total</small><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)}</strong></span><span><small>Paid</small><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(effectiveAmountPaid)}</strong></span><span><small>Balance</small><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(balance)}</strong></span></div>
            <Button type="submit" size="lg" disabled={saving || nights < 1 || !roomLabel}>{saving ? "Saving…" : editingBookingId ? "Save changes" : "Create booking"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedBooking} onOpenChange={(open) => !open && setSelectedBooking(null)}>
        <DialogContent className="mobile-dialog booking-detail" showCloseButton={false}>
          {selectedBooking && <>
            <button className="detail-close" onClick={() => setSelectedBooking(null)} aria-label="Close"><X /></button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button className="detail-menu" aria-label="More booking actions"><MoreVertical /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setDeleteBookingDialog(true)}><Trash2 /> Delete permanently</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
            <DialogHeader><span className={`status-pill ${selectedBooking.status}`}>{selectedBooking.status === "checked_out" ? "checked out" : selectedBooking.status}</span><DialogTitle>{selectedBooking.guestName}</DialogTitle><DialogDescription>{selectedBooking.roomLabel} · {format(parseISO(selectedBooking.checkIn), "MMM d")} – {format(parseISO(selectedBooking.checkOut), "MMM d, yyyy")}</DialogDescription></DialogHeader>
            <div className="detail-total"><span>{differenceInCalendarDays(parseISO(selectedBooking.checkOut), parseISO(selectedBooking.checkIn))} nights at {money(selectedBooking.nightlyPriceCents)}{feesFor(selectedBooking).length ? ` + ${feesFor(selectedBooking).length} fee${feesFor(selectedBooking).length === 1 ? "" : "s"}` : ""}</span><strong>{money(selectedBooking.totalPriceCents)}</strong></div>
            {feesFor(selectedBooking).length > 0 && <div className="detail-fees">{feesFor(selectedBooking).map((fee, index) => <span key={`${fee.name}-${index}`}><small>{fee.name}</small><strong>{money(fee.amountCents)}</strong></span>)}</div>}
            <div className="guest-detail-grid"><span><small>Check-in</small><strong>{displayTime(selectedBooking.checkInTime)}</strong></span><span><small>Check-out</small><strong>{displayTime(selectedBooking.checkOutTime)}</strong></span></div>
            <div className="guest-detail-grid"><span><small>Guests</small><strong>{selectedBooking.guestCount}</strong></span><span><small>Phone</small><strong>{selectedBooking.guestPhone || "Not added"}</strong></span><span><small>Email</small><strong>{selectedBooking.guestEmail || "Not added"}</strong></span></div>
            <div className="payment-detail"><span><small>Payment</small><strong>{paymentState(selectedBooking)}</strong></span><span><small>Method</small><strong>{selectedBooking.paymentMethod === "credit_card" ? "Credit card" : selectedBooking.paymentMethod === "cash" ? "Cash" : "Not set"}</strong></span><span><small>Paid</small><strong>{money(selectedBooking.amountPaidCents)}</strong></span><span><small>Balance</small><strong>{money(Math.max(0, selectedBooking.totalPriceCents - selectedBooking.amountPaidCents))}</strong></span></div>
            <div className={`cleaning-detail ${selectedBooking.cleaningStatus === "clean" ? "clean" : "not-clean"}`}><span><Sparkles /><span><small>Cleaning</small><strong>{selectedBooking.cleaningStatus === "clean" ? "Clean" : "Not clean"}</strong></span></span><Button variant="outline" size="sm" onClick={() => updateCleaningStatus(selectedBooking.cleaningStatus === "clean" ? "not_clean" : "clean")}>Mark {selectedBooking.cleaningStatus === "clean" ? "not clean" : "clean"}</Button></div>
            {selectedBooking.notes && <p className="detail-notes">{selectedBooking.notes}</p>}
            <div className="detail-actions">
              {selectedBooking.status !== "cancelled" && selectedBooking.status !== "checked_out" && <Button variant="outline" onClick={() => openEditBooking(selectedBooking)}><Pencil /> Edit booking</Button>}
              {selectedBooking.status !== "cancelled" && selectedBooking.status !== "checked_out" && <Button onClick={() => bookAnotherRoom(selectedBooking)}><Plus /> Choose dates for another room</Button>}
              {selectedBooking.status !== "confirmed" && selectedBooking.status !== "cancelled" && <Button onClick={() => updateBooking("confirmed")}>Mark confirmed</Button>}
              {selectedBooking.status === "confirmed" && <Button onClick={() => updateBooking("checked_out")}>Confirm checked out</Button>}
              {selectedBooking.status !== "cancelled" && <Button variant="outline" className="danger-button" onClick={() => updateBooking("cancelled")}>Cancel booking</Button>}
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteBookingDialog} onOpenChange={setDeleteBookingDialog}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes {selectedBooking?.guestName ?? "this booking"} and all of its guest payment and date information. Use Cancel booking instead when you need to keep a record.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep booking</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={saving} onClick={deleteBooking}>{saving ? "Deleting…" : "Delete permanently"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dayBookings.length > 0} onOpenChange={(open) => !open && setDayBookings([])}>
        <DialogContent className="mobile-dialog">
          <DialogHeader><DialogTitle>Bookings on this day</DialogTitle><DialogDescription>Select a room to view its booking.</DialogDescription></DialogHeader>
          <div className="day-booking-list">{dayBookings.map((booking) => <button key={booking.id} onClick={() => { setDayBookings([]); setSelectedBooking(booking); }}><span><strong>{booking.roomLabel}</strong><small>{booking.guestName}</small></span><ChevronRight /></button>)}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={searchDialog} onOpenChange={setSearchDialog}>
        <DialogContent className="mobile-dialog search-dialog">
          <DialogHeader><DialogTitle>Search bookings</DialogTitle><DialogDescription>Search guest  listing  room  phone  email or date.</DialogDescription></DialogHeader>
          <div className="search-field"><Search /><Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search bookings" autoFocus /></div>
          {normalizedSearch ? searchResults.length ? <div className="booking-list search-results">{searchResults.map((booking) => <button key={booking.id} className="booking-list-item" onClick={() => { setSearchDialog(false); setSelectedBooking(booking); }}><span className="booking-list-date"><strong>{format(parseISO(booking.checkIn), "MMM d")}</strong><small>{format(parseISO(booking.checkOut), "MMM d")}</small></span><span className="booking-list-copy"><strong>{booking.guestName}</strong><small>{propertyForBooking(booking)?.name} · {booking.roomLabel}</small></span><ChevronRight /></button>)}</div> : <p className="search-empty">No matching bookings</p> : <p className="search-empty">Start typing to search every booking</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
        <DialogContent className="mobile-dialog payment-dialog">
          <DialogHeader><DialogTitle>Payment tracking</DialogTitle><DialogDescription>Bookings with an unpaid balance</DialogDescription></DialogHeader>
          <div className="outstanding-summary"><small>Total outstanding</small><strong>{money(outstandingTotal)}</strong><span>{outstandingBookings.length} {outstandingBookings.length === 1 ? "booking" : "bookings"}</span></div>
          <div className="payment-filters" aria-label="Payment filters">
            <button className={paymentFilter === "all" ? "active" : ""} onClick={() => setPaymentFilter("all")}>All due</button>
            <button className={paymentFilter === "unpaid" ? "active" : ""} onClick={() => setPaymentFilter("unpaid")}>Unpaid</button>
            <button className={paymentFilter === "partial" ? "active" : ""} onClick={() => setPaymentFilter("partial")}>Partial</button>
          </div>
          {paymentResults.length ? <div className="booking-list payment-results">{paymentResults.map((booking) => bookingListButton(booking))}</div> : <p className="search-empty">No bookings in this payment group</p>}
        </DialogContent>
      </Dialog>
    </main>
  );
}
